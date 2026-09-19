# Ingestion Service — build report

*Sections 1–4 record Phase 0 and Phase A as of 6 September 2026. Section 5 is
kept current; it was last updated on 10 September 2026 with the Step Functions
migration.*

**Status:** the ETL pipeline runs end to end against a real database and is
migrated to Step Functions with one Lambda per stage. A 40-row mixed fixture
gives 34 loaded, 6 rejected, job `PARTIAL`, every invariant clean. Re-running
the same job changes nothing.

**Scale:** 6,830 lines of source, 5,829 lines of test, 34 suites, 531 unit
tests plus 25 integration tests. Typecheck and build clean.

---

## 1. What the service does

A dealer with 400 vehicles cannot type them into a web form. They export a CSV
from whatever system they already use and upload it. That file is dirty in
predictable ways — `TOYATA`, `Rs. 3,500,000`, `45,000 km`, a blank model, a
mileage of `-100` — and the platform has to turn it into rows that behave
exactly like manually created listings, including in semantic search.

```
Dealer CSV  ──▶  [ ETL pipeline ]  ──▶  marketplace.vehicles
                                        (PENDING_REVIEW, searchable, embedded)
                        │
                        └──▶  ingestion.rejected_records   (with reasons)
                        └──▶  ingestion.etl_stage_logs     (per stage, per chunk)
```

Three things had to be true, and they drove nearly every decision:

1. **A bad row must not cost a good row.** One malformed line in 400 rejects
   that line, not the upload.
2. **Bulk listings must be indistinguishable from manual ones** — same search
   text, same embedding model, same vector space. Otherwise bulk stock ranks
   badly forever with no error anywhere.
3. **It must run today without AWS, and deploy later without a rewrite.**

---

## 2. Architecture

### The stage contract

Every stage is a plain object with one method:

```ts
interface StageRunner<TIn, TOut> {
  readonly stage: EtlStage;
  run(ctx: StageContext, input: TIn): Promise<TOut>;
}
```

A stage **may not** import NestJS, import an AWS SDK, or open a database
connection except through a port handed to it in `StageContext`. That is what
lets the same code run under `LocalOrchestrator` today and behind a Lambda
handler after deployment without touching a single stage function.

**The rule that shapes everything else: a stage never throws because a row is
bad.** Bad rows come back as `rejections` alongside `rows`; only infrastructure
failure throws. This is why `PARTIAL` job status and per-row
`rejected_records` fall out of the design instead of needing special-casing at
every level.

### The flow

```
POST /ingest/upload  (B1, not built yet)
  └─ store file → insert job PENDING → JobQueue.publish → 202 { jobId }
                          │
              LocalOrchestrator.run(jobId)
                          │
   ┌──────────────────────┴────────────────────────────────────┐
   │  validateFile  ──▶  splitChunks                            │  whole-file
   │        │                                                   │
   │        ▼  fan out, bounded concurrency 10                   │
   │  ┌─────────────────────────────────────────────────┐       │
   │  │ parseNormalize → groqNormalize → validateRows    │       │  per chunk
   │  │   → enrich → embed → load                        │       │
   │  └─────────────────────────────────────────────────┘       │
   │        │                                                   │
   │        ▼  tally                                            │
   │  COMPLETED / PARTIAL / FAILED                              │
   └────────────────────────────────────────────────────────────┘
```

### Ports, not SDKs

```ts
interface ObjectStore { put, get, getStream, exists, list }
interface JobQueue    { publish({ jobId }) }
```

`LocalObjectStore` writes to the filesystem; `InProcessJobQueue` dispatches on
`setImmediate`. Swapping in S3 and SQS later means writing two classes, not
editing the pipeline.

Driver selection **throws** on `s3`/`sqs` rather than silently falling back — a
half-configured deployment writing dealer uploads to ephemeral container disk
is worse than a startup failure.

---

## 3. What was built, in order

### Phase 0 — foundations

Nine defects found by reading the codebase before writing anything:

| # | Defect | Why it mattered |
|---|---|---|
| D1 | Controller served `/upload-jobs/:id`, contract and nginx say `/jobs/{id}` | Every gateway call 404'd |
| D2 | `jest.rootDir: "src"` | **Every spec under `test/` was silently never discovered** |
| D3 | No CI workflow, no `test:ci`, no e2e config | Nothing ran on push |
| D4 | No global `ValidationPipe` | DTO validation silently absent |
| D5 | `VehicleDictionaryView` missing `vehicle_types[]` | The normalizer needs it to derive `vehicle_type` |
| D6 | nginx had no `client_max_body_size` on `/ingest/` | Default **100k** — real uploads rejected |
| D7 | Generator emits BMW/Mercedes models absent from the seed | Generated fixtures unresolvable by construction |
| D8 | Seed's `ON CONFLICT` named a superseded constraint | **Re-running the seed errored** |
| D9 | No `INGESTION_*` env vars at all | Nothing configurable |

D2 is the one worth dwelling on: the test directory existed, tests could be
written, and jest would report success having discovered none of them.

**The shared-module decision.** `buildSearchText` and `EMBEDDING_MODEL_ID` must
be byte-identical between ingestion and search. The obvious fix — extract a
package — was rejected: it breaks all seven Dockerfiles (`npm ci` runs before
`COPY src`), forces the build context to the repo root, changes CI, and stops
working entirely once the directories become separate repos.

Instead each service keeps its own copy, and
`test/unit/shared/normalize-embed-parity.spec.ts` reads the sibling service's
files off disk and byte-compares them. Drift becomes a red build instead of a
silent ranking failure. The test skips itself when the sibling path is absent —
i.e. once the repos split, at which point it becomes a published-package
problem instead.

---

### A1 — the dictionary

**The problem.** A dealer writes `TOYATA`, `wagon-r`, `  suzuki `. The database
says `Toyota`, `Wagon R`, `Suzuki`. Something has to fold one into the other
**without querying per row** — the ETL runs 10 chunks concurrently against a
5-connection pool, so a 5,000-row upload doing one lookup per field would open
15,000 queries.

**The answer.** `InMemoryDictionarySnapshot` loads all 177 rows once per run —
measured at **16 ms** — then resolves entirely in memory:

```
compact(raw)  →  lowercase, strip punctuation, collapse whitespace
   │
   ├─ 1. exact canonical match          → confidence 1.0
   ├─ 2. unambiguous alias match        → confidence 0.8
   └─ 3. fuzzy trigram (Dice ≥ 0.45)    → confidence 0.6
```

Confidence isn't decoration: `parseNormalize` compares the row's weakest field
against `INGESTION_GROQ_CONFIDENCE_THRESHOLD` (default 0.6) to decide what goes
to the LLM.

**The ambiguity margin** is the subtle part. Suppose `Corola` scores 0.72
against `Corolla` and 0.71 against `Corsa`. Without a guard the loop picks
whichever it saw first — *a coin flip written permanently into a dealer's
inventory*. With `AMBIGUITY_MARGIN = 0.05`, the value is left unresolved and
falls to Groq, which has actual context. **Silence beats a confident wrong
answer.**

Models are scoped by parent: `Civic` under Toyota returns `null`, not Honda's
Civic.

`trigram.ts` was copied from the search parser rather than rewritten —
ingestion and search must fold aliases identically or the two halves of the
platform disagree about what a dealer meant.

---

### A2 — file intake

**`csv-contract.ts`** is the single definition of the dealer CSV. `validateFile`
checks headers against it, `splitChunks` parses with it, and B5's
downloadable template is generated from it. Three consumers, one list.

Required: `make, model, year, price, mileage`. **`registration_number` is
deliberately not required** — unregistered imports are legitimate stock.

~35 header aliases (`Manufacturer`→`make`, `YOM`→`year`, `Odometer`→`mileage`).
Dealers hand-edit these in Excel; accepting variants costs nothing, rejecting
the file costs a support ticket.

**`validateFile` is the only stage allowed to fail a whole job on content.**
The "never throw on a bad row" rule exists so one row cannot fail a job — but a
file with no header row has *no rows to reject*, and 5,000 identical per-row
rejections would be worse than one sentence.

It reads only the first 64 KB. A 25 MB upload buffered whole, across concurrent
jobs, is a footprint worth avoiding for a check that looks at line one.

Three non-obvious guards:

- **Strict UTF-8 decode.** A UTF-16 file decoded leniently becomes replacement
  characters and fails later as a mystery dictionary miss on *every row*.
- **Quote-aware first line.** `"model, trim",price` is one column; splitting on
  the raw comma shifts every subsequent header and mis-keys the file.
- **Duplicate detection.** `make` and `Manufacturer` both fold to `make`;
  picking either silently discards a column's data for every row.

**`splitChunks`** streams end to end — rows accumulate only to `chunkSize`
before flushing, so memory is one chunk regardless of file size.

`relaxColumnCount` matters more than it reads: without it, one ragged line makes
csv-parse throw and **the dealer loses every valid row in the upload**.

Chunk keys are zero-padded (`chunk-000`). `ObjectStore.list` sorts
lexicographically — unpadded, `chunk-10` precedes `chunk-2` and a retry replays
out of order.

---

### A3 — parseNormalize

Two rules shape this stage.

**It never rejects a row.** Even a row with nothing resolvable passes through
with low confidence. `validateRows` is the single gate, so every rejection
reason lives in one place — and Groq still gets a shot at rows this stage
couldn't read.

**Confidence is the minimum, not the mean.** A row whose make resolved exactly
but whose model didn't is not 80 % correct; it is wrong where it matters.
Averaging would hide that behind four confident cells and skip the fallback.

Blank optional fields aren't scored at all. Most dealer sheets carry five
columns; counting an absent `color` as a miss would drag every row below the
threshold and send the whole file to an LLM with nothing to work with.

**`coerce.ts`** — dealers type prices the way they say them.
`Number("Rs. 3,500,000")` is `NaN`, which would reject a perfectly good row over
a currency prefix. So: strip currency and units, expand `3.5M` and `45K`.

Two decisions worth flagging:

- **`"3,5"` returns null.** European decimal notation or a typo — stripping the
  comma turns 3.5 into 35, *a tenfold error in a price*. Ambiguity is refused,
  not guessed.
- **Null, never 0 or NaN.** `0` is a price; null is a missing value
  `validateRows` can reject with a reason.

Registration numbers fold to one canonical form (`cab 1234` → `CAB-1234`)
because they're compared against a UNIQUE partial index — inconsistent
formatting would let the same vehicle be listed twice, the exact duplicate that
index exists to prevent.

**`enum-vocabulary.ts`** was copied from search's `vocabulary.ts`. Search
already accepts `deisel`, `hyrbid`, `hybird`. If ingestion didn't, a dealer
typing `deisel` would store an unresolved value **that a buyer typing the same
word could never reach.**

No fuzzy fallback here, deliberately: a closed vocabulary has short words, and a
typo landing between two fuel types would silently mislabel a vehicle.

**`vehicle_type` derivation** — dealer's explicit value wins; otherwise the
matched *model*'s `vehicleTypes[]` (a Hilux is a `PICKUP`); falling back to the
**make** only when it holds exactly one value. Toyota carries CAR, SUV, VAN,
PICKUP and LORRY — taking the first would type every unresolved Toyota as a car,
**lorries included**.

---

### A5 — validateRows, the gate

Every row reaching Load passes through here, and every rejection reason
originates here.

**Two categories of check, for different reasons.**

*Business rules* mirror marketplace's `CreateListingDto`: year ∈ [1980, next
year], price > 0, mileage ≥ 0. A vehicle a dealer couldn't create through the UI
must not arrive through a spreadsheet.

*Column bounds* aren't pedantry. `manufacture_year` is `smallint`, `price` is
`numeric(14,2)`, `chassis_number` is `varchar(100)`. An over-long value raises
at INSERT — and **because Load batches rows, one bad value fails every good row
travelling with it.** Catching it here turns a lost batch into one rejected row.

**The intra-job duplicate check closes a silent data loss.** Two rows sharing a
registration number both upsert under `idx_vehicles_job_registration`: the
second overwrites the first, no error, no rejected record. The dealer sees
"50 loaded" for 51 rows and never learns which vanished.

A row claims its registration number only if it is *otherwise valid* — else a
rejected row would shadow a good one further down the file.

Other decisions: all problems collected per row, not first-failure (a dealer
fixing one error per upload round-trip is the failure mode avoided); `make is
missing` vs `make "Lamborghini" could not be recognised` reported differently
because they call for different fixes.

---

### A4 — groqNormalize (keyless)

Candidate selection, the whitelist contract and the degradation posture are
real; only the HTTP call is deferred.

**The keyless path is required behaviour, not a placeholder.** CI has no key,
and a dealer upload cannot fail because a third party is down. Shipping it first
means the degraded path is the one already under test.

Selection is **strictly below** the threshold. A fuzzy hit scores exactly 0.6
and the default threshold is 0.6 — a trigram match the snapshot already vouched
for, with an ambiguity margin, isn't re-litigated by an LLM.

`metrics.candidates` counts what *would* have been sent, so the value of
enabling Groq is measurable before anyone pays for it.

**When the live call lands, three rules must not break:**
every returned value is checked against the snapshot (an LLM inventing "Toyota
Corrolla" would write a pair no facet can match); failure degrades rather than
rejects; it never rejects a row.

---

### A6 — enrich + embed

**`enrich`** runs after `validateRows`, so every row is already loadable — it
only adds. Defaults `condition = USED` and `is_negotiable = false`, then builds
the `specs` jsonb.

**Body type is resolved here, and that is not cosmetic.** `buildSearchText`
reads `specs.body_type`. A bulk row without it produces a *shorter search text*
than the equivalent manual listing — and different text embeds to a different
vector. **FR-22.1 drift arriving through the side door.**

Two things dropped rather than kept: out-of-range int specs (200 seats is a
typo; clamping to 60 invents a plausible-looking fact) and unknown dealer
columns (`specs` is queried against `KNOWN_SPEC_KEYS`, so an arbitrary column
is unqueryable weight that still *looks like data*).

**`embed` is where model parity is enforced.** It passes exactly the 10 fields
`ListingSearchIndexService` passes, in the same order, from the same shared
module, with the same `.trim()` and empty-to-null fold.

The centrepiece test builds the manual path's text **independently** and asserts
byte equality. Change the field list on either side and it goes red.

Two guards, working together:

```
normalize-embed-parity.spec  →  our copy == marketplace's copy    (byte-identical)
embed.stage.spec             →  our usage == marketplace's usage  (same 10 fields)
```

Without both, bulk listings land in a different region of vector space and rank
badly **forever — no error, no failing test, no log line.**

A missing vector is never a row failure, matching the manual path. The row keeps
`search_text`, so lexical search still finds it and a re-embed repairs the
vector later. Refusing the row could not.

The embedder is a module singleton — the ONNX model is ~90 MB, and loading it
per chunk under concurrency 10 means ten simultaneous loads.

---

### A7 — the one cross-schema write

`MarketplaceVehiclesWriteAdapter` carries a banner header, because ADR-002's
exception is only defensible while it is confined to one class. **A second
writer does not break a test; it dissolves the architectural claim silently.**

Four details that would each have been a production bug:

**The conflict target repeats the index's WHERE clause.**
`idx_vehicles_job_registration` is *partial*. A target omitting the predicate
doesn't match the index and Postgres raises — not at review, at runtime on the
first upload.

**Batch, then isolate on conflict.** A batch INSERT aborts *entirely* on the
first violation: one duplicate in a 250-row chunk would lose all 249 good rows.
One statement in the common case, degrading to per-row only when a duplicate is
actually present.

The conflict caught there is the **global** unique from migration 6000 — it
fires when a dealer re-uploads a vehicle already listed under a *different* job,
which the composite target structurally cannot catch because the job IDs differ.

**`search_vector` is never written.** `trg_vehicles_search_vector` fills it from
`search_text`. Writing it would be overwritten by the trigger — or worse, drift
from `search_text` if the trigger were ever dropped.

**`dealer_id` comes from the job, never the CSV.** A `dealer_id` column in an
uploaded file must not be able to assign stock to another dealer.

A test asserts **no `DELETE` is ever emitted** — the role lacks the grant
precisely so ETL cannot destroy manually created listings.

---

### A8 — LocalOrchestrator

Transcribes SAD §6.6: same stage decomposition, same fan-out, same concurrency
bound. Only the executor differs.

**Chunk isolation is a correctness requirement, not resilience polish.** Every
chunk runs inside its own error boundary — that is precisely what produces
`PARTIAL` rather than `FAILED`. A dealer whose 400th row breaks the writer
should still get 399 vehicles.

| Outcome | Meaning |
|---|---|
| `COMPLETED` | Everything loaded, nothing rejected |
| `PARTIAL` | Some rows rejected, or some chunk failed |
| `FAILED` | Nothing landed at all |

A header-only file is `COMPLETED` with zero counts — an empty inventory is not a
failure.

**Retry on Load alone.** Its failures are typically transient (dropped
connection, lock timeout), whereas a stage that rejected a row will reject it
identically on a second run.

**The `succeededChunks` skip makes re-runs idempotent.** Rows with a null
registration number miss *both* partial indexes — the database cannot
deduplicate what it has no key for, so skipping the chunk is their only
protection.

`concurrency.ts` is 38 lines, hand-rolled. A package would be more code to audit
than to write, and one fewer thing that has to stay true when this is replaced
by ASL. It deliberately does **not** catch rejections — the orchestrator's own
boundary is what distinguishes a failed chunk from a good one.

`EtlWorkerService` replaced the `QueueBootstrapService` placeholder at the same
registration point on the same queue instance, so the swap changed one handler
and nothing around it.

---

## 4. The end-to-end run

```bash
docker compose up -d postgres
npm --prefix database run migration:run && npm --prefix database run grants
npm --prefix database run seed:dictionaries

cd ingestion-service
npx tsx src/tools/vehicle-generator/vehicle-generator.ts \
    --count 40 --mode mixed --output test/fixtures/e2e-mixed.csv
npm run build
node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv
```

**Result:** 40 rows → 34 loaded, 6 rejected, `PARTIAL`, 41 s (most of it the
one-time model load).

| Invariant | Result |
|---|---|
| All rows `PENDING_REVIEW` | 0 wrong |
| `search_vector` populated (trigger fired) | 0 null |
| `embedding` populated | 0 null |
| `dealer_id` set from job | 0 null |
| All 8 stages logged | ✓ incl. `GROQ_NORMALIZE: SKIPPED` |

The rejections are genuinely correct — the generator's dirty/invalid modes
inject exactly these:

```
row 10  model is missing
row 11  make is missing; model "X-Trail" could not be recognised
row 14  mileage cannot be negative, got -100
```

Normalization visibly working: `UnknownFuel` → `fuel_type: null` with the row
still loading (low confidence is not invalidity); `manual` → `MANUAL`; `Wagon` →
`WAGON` via the dictionary; `vehicle_type: SUV` derived for an X1 the CSV never
typed.

**Idempotency:** re-running the same job → identical 34 / 6, no duplicates.

### Two bugs the live run caught

**1. tsx cannot run this service.** `emitDecoratorMetadata: true`, but tsx uses
esbuild, which doesn't emit decorator metadata — every constructor's parameter
types vanish and Nest can't resolve anything. Not a code bug; tools must run
from `dist/`.

**2. A re-run downgraded a finished job to `FAILED`.** The skip worked and
created no duplicates, but `finish()` tallied only *this run's* outcomes — and a
fully resumed run loads nothing new. A harmless retry would have turned
`COMPLETED` into `FAILED`.

Fixed by counting from the database (`countForJob`) rather than from the run.
**Only the live run could have caught this** — every unit test was passing.

---

## 5. Where things stand

*Updated 10 September 2026.*

### Built

```
Phase 0   hygiene · shared module + drift guard · ports · repositories · CI
A1        dictionary seed fixes · in-memory snapshot
A2        csv-contract · validateFile · splitChunks
A3        coerce · enum-vocabulary · parseNormalize
A4        Groq fallback, live HTTP call and whitelist
A5        validateRows gate
A6        enrich · embed  (FR-22.1 parity)
A7        MarketplaceVehiclesWriteAdapter · load stage
A8        LocalOrchestrator · EtlWorkerService  (placeholder deleted)
A9        integration tests against live Postgres

          search-text enrichment: price, mileage and age bands, equipment terms
          MarketplaceVehicleImagesWriteAdapter (the ADR-002 pair completed)

S1        chunk envelopes — stages exchange S3 pointers, not rows
S2        S3ObjectStore · SqsJobQueue
S3        12 Lambda handlers · per-container bootstrap
S4        the ASL state machine
S5        drift guard — the ASL is asserted against pipeline/graph.ts
S6        connection pooling for Lambda (max: 1, timeouts)
S7        per-function packaging: memory, timeouts, zip vs container image
```

**34 suites, 531 unit tests, 25 integration tests. Typecheck and build clean.**

### Remaining — mine

- **S8 — Terraform.** 11 Lambda functions, IAM per function, the state machine
  resource, an S3 bucket with a 7-day lifecycle on `staging/`, the SQS queue,
  **RDS Proxy** (the infrastructure half of S6), and the EventBridge Pipe that
  turns a queue message into an execution.
  `src/infrastructure/step-functions/function-config.ts` already declares
  memory, timeout and environment per function for it to consume.

- **The model-parity SQL check.** Blocked on B1: create a listing manually,
  then compare `search_text` and cosine distance against the equivalent bulk
  row. The unit test proves the *text* matches; only this proves the *vectors*
  do.

### Remaining — Virusan

B1 upload API · B2 job-status extension · B3 images · B4 notify ·
B5 dealer frontend · B6 e2e tests.

Briefed in `docs/HANDOVER-VIRUSAN.md`. **Nothing there is blocked on me** — the
image write adapter and the CSV header, the two things that would have required
a hand-off, are both built and documented.

### Deferred by decision

ECR pushes and the deployment pipeline itself, until S8 lands. The ports made
the AWS drivers additive rather than a rewrite, and the same holds here: the
state machine and the handlers exist, only the infrastructure that hosts them
does not.

---

## 6. Decisions worth remembering

| Decision | Why |
|---|---|
| Copy `normalize-embed` per service, guard with a test | A shared package breaks 7 Dockerfiles and dies when the repos split |
| Dictionary snapshot, never per-row queries | 10 concurrent chunks against a 5-connection pool |
| Ambiguity margin on fuzzy matches | A coin flip written into a dealer's inventory is worse than an unresolved value |
| Confidence = minimum, not mean | Averaging hides the one field that was wrong |
| Only `validateFile` may fail a job on content | Everything else has rows to reject individually |
| `validateRows` is the single gate | One place lists every rejection reason |
| One cross-schema writer class | The ADR-002 exception is only defensible while confined |
| Chunk isolation | This *is* the `PARTIAL` status |
| Retry Load only | Its failures are transient; a rejection is deterministic |
| Count from the database on finish | A resumed run loads nothing new |
