# ingestion-service — the ETL pipeline

Reference for the bulk-upload pipeline: what each stage does, why it does it
that way, and how to run and debug it.

For a task-oriented "what do I build next", see [HANDOVER.md](../HANDOVER.md).
For the build history and decisions taken, see [PHASE-A-REPORT.md](PHASE-A-REPORT.md).

---

## 1. The problem

A dealer with 400 vehicles will not type them into a web form. They export a
CSV from whatever system they already use and upload it. That file is dirty in
predictable ways:

```csv
registration_number,make,model,year,price,mileage,fuel_type,transmission,body_type
CAB-1234,toyata,vits,2015,"Rs. 3,500,000","45,000 km",Petrol,Auto,Saloon
WP CAB-99,TOYOTA MOTOR CORP JAPAN,Land Cruiser Prado TX,18,25M,60000,deisel,automatic,jeep
,Honda,Fit,2016,4200000,38000,Hybrid,CVT,Hatchback
CAB-777,Lamborghini,Aventador,2020,90000000,-100,Petrol,Automatic,Coupe
```

Every one of those rows is a real pattern. Row 1 has misspellings, a currency
prefix and a unit suffix. Row 2 has a two-digit year, shorthand price, a
company name instead of a make, and a trim level in the model. Row 3 is an
unregistered import — legitimate stock with no plate. Row 4 has a make we do
not carry and a negative mileage.

The pipeline turns what it can into rows that behave **exactly like manually
created listings** — including in semantic search — and rejects the rest with
reasons the dealer can act on.

Three requirements shaped every decision:

1. **A bad row must not cost a good row.** One malformed line in 400 rejects
   that line, not the upload.
2. **Bulk listings must be indistinguishable from manual ones.** Same search
   text, same embedding model, same vector space.
3. **It must run today without AWS, and deploy later without a rewrite.**

---

## 2. Shape

```
POST /ingest/upload                                      [B1, not built yet]
  └─ store file → insert job PENDING → JobQueue.publish → 202 { jobId }
                          │
             LocalOrchestrator.run(jobId)
                          │
  ┌───────────────────────┴─────────────────────────────────────┐
  │  validateFile  ──▶  splitChunks                              │  whole-file
  │        │                                                     │
  │        ▼   fan out, bounded concurrency 10                    │
  │  ┌──────────────────────────────────────────────────┐        │
  │  │ parseNormalize → groqNormalize → validateRows     │        │  per chunk
  │  │      → enrich → embed → load                      │        │
  │  └──────────────────────────────────────────────────┘        │
  │        │                                                     │
  │        ▼   tally                                             │
  │  COMPLETED / PARTIAL / FAILED                                │
  └──────────────────────────────────────────────────────────────┘
                          │
        marketplace.vehicles  ·  ingestion.rejected_records
                              ·  ingestion.etl_stage_logs
```

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
failure throws.

That single rule is why `PARTIAL` status and per-row `rejected_records` fall
out of the design instead of needing special-casing at every level. `validateFile`
is the one exception, and only because a file with no header row has *no rows*
to reject individually.

### Ports, not SDKs

```ts
interface ObjectStore { put, get, getStream, exists, list }
interface JobQueue    { publish({ jobId }) }
```

`LocalObjectStore` writes to the filesystem; `InProcessJobQueue` dispatches on
`setImmediate`. Swapping in S3 and SQS means writing two classes, not editing
the pipeline.

Driver selection **throws** on `s3`/`sqs` rather than silently falling back — a
half-configured deployment writing dealer uploads to ephemeral container disk is
worse than a startup failure.

---

## 3. The stages

### validateFile

`pipeline/validate/validate-file.stage.ts`

The gate between an uploaded blob and the pipeline: extension, non-emptiness,
UTF-8 decodability, a parseable header row, and the required columns.

**The only stage permitted to fail a whole job on content.** A file with no
header row has no rows to reject, and reporting 5,000 identical per-row
rejections would be worse than one sentence.

Reads only the first **64 KB**. A 25 MB upload buffered whole, across concurrent
jobs, is a footprint worth avoiding for a check that looks at line one.

Three guards that are less obvious than they look:

- **Strict UTF-8 decode.** A UTF-16 file decoded leniently becomes replacement
  characters and fails later as a mystery dictionary miss on *every row*, rather
  than here as one comprehensible message.
- **Quote-aware first line.** `"model, trim",price` is one column; splitting on
  the raw comma shifts every subsequent header and mis-keys the whole file.
- **Duplicate detection.** `make` and `Manufacturer` both fold to `make`;
  picking either silently discards a column's data for every row.

### splitChunks

`pipeline/parse/split-chunks.stage.ts`

Streams the file into `staging/{jobId}/chunk-000.json` files on the object
store, so the rest of the pipeline fans out over chunks rather than rows.

Rows accumulate only to `chunkSize` before flushing, so memory is one chunk
regardless of file size. Under concurrency 10 that difference is the entire
footprint of the worker.

`relaxColumnCount` matters more than it reads: without it, one ragged line makes
csv-parse throw and **the dealer loses every valid row in the upload**. With it,
that line becomes a row-level rejection downstream.

Chunk keys are zero-padded. `ObjectStore.list` sorts lexicographically —
unpadded, `chunk-10` precedes `chunk-2` and a retry replays out of order.

### parseNormalize

`pipeline/normalize/parse-normalize.stage.ts`

Turns raw cells into typed, dictionary-resolved vehicle fields. Two rules:

**It never rejects a row.** Even a row with nothing resolvable passes through
with low confidence. `validateRows` is the single gate, so every rejection
reason lives in one place — and Groq still gets a shot at rows this stage
could not read.

**Confidence is the minimum across fields the dealer filled in, not the mean.**
A row whose make resolved exactly but whose model did not is not 80 % correct;
it is wrong where it matters. Averaging would hide that behind four confident
cells and skip the fallback.

Blank optional fields are not scored at all. Most dealer sheets carry five
columns; counting an absent `color` as a miss would drag every row below the
threshold and send the whole file to an LLM with nothing to work with.

#### Numeric coercion — `normalize/coerce.ts`

Dealers type prices the way they say them. `Number("Rs. 3,500,000")` is `NaN`,
which would reject a perfectly good row over a currency prefix.

| Input | Output |
|---|---|
| `Rs. 3,500,000/=` | `3500000` |
| `3.5M`, `35 lakhs` | `3500000` |
| `45,000 km` | `45000` |
| `1500cc` | `1500` |
| `15` (year) | `2015` |
| `98` (year) | `1998` |
| `cab 1234` | `CAB-1234` |
| `"3,5"` | **null** |

That last row is deliberate. `"3,5"` is European decimal notation or a typo —
stripping the comma turns 3.5 into 35, **a tenfold error in a price**. Ambiguity
is refused, not guessed.

Unparseable cells return **null, never 0 or NaN**: `0` is a price, null is a
missing value `validateRows` can reject with a reason.

Registration numbers fold to one canonical form because they are compared
against a UNIQUE partial index (FR-35.1) — inconsistent formatting would let the
same vehicle be listed twice, the exact duplicate that index exists to prevent.

#### Enum folding — `normalize/enum-vocabulary.ts`

Copied from marketplace's search parser, for the same reason `trigram.ts` is:
**search already accepts `deisel`, `hyrbid`, `hybird`.** If ingestion did not, a
dealer typing `deisel` would store an unresolved value *that a buyer typing the
same word could never reach.*

Coercion here is **exact-or-nothing, no fuzzy fallback**. A closed vocabulary
has short words, and a typo landing between two fuel types would silently
mislabel a vehicle. Unknown → null → Groq, which sees the whole row.

#### vehicle_type derivation

The dealer CSV contract does not require the column, so it is derived:

1. The dealer's explicit value, if recognised
2. The matched **model**'s `vehicle_types[]` — a Hilux is a `PICKUP`
3. The **make**'s array, *only when it holds exactly one value*

Step 3's restriction matters: Toyota carries `CAR, SUV, VAN, PICKUP, LORRY`.
Taking the first would type every unresolved Toyota as a car — **lorries
included**. Ambiguity is left for `enrich` to default.

### The dictionary snapshot

`pipeline/normalize/dictionary-snapshot.ts`

Something has to fold `TOYATA` into `Toyota` **without querying per row** — the
ETL runs 10 chunks concurrently against a 5-connection pool, so a 5,000-row
upload doing one lookup per field would open 15,000 queries.

So: load all 177 rows once per run (**16 ms** measured), resolve in memory.

```
compact(raw)  →  lowercase, strip punctuation, collapse whitespace
   │
   ├─ 1. exact canonical match          → confidence 1.0
   ├─ 2. unambiguous alias match        → confidence 0.8
   └─ 3. fuzzy trigram (Dice ≥ 0.45)    → confidence 0.6
```

Models are scoped by parent: `Civic` under Toyota returns `null`, not Honda's
Civic.

**The ambiguity margin is the subtle part.** Suppose `Corola` scores 0.72
against `Corolla` and 0.71 against `Corsa`. Without a guard the loop picks
whichever it saw first — *a coin flip written permanently into a dealer's
inventory*. With `AMBIGUITY_MARGIN = 0.05` the value is left unresolved and
falls to Groq, which has context a trigram score does not.

**Silence beats a confident wrong answer.**

### groqNormalize

`pipeline/normalize/groq-normalize.stage.ts`

The LLM fallback for rows the dictionary could not resolve (ADR-004: rules
first, LLM second).

**With no `GROQ_API_KEY` the stage logs `SKIPPED` and rows pass through
untouched** — *correct behaviour, not a stub*. CI has no key, and a dealer
upload cannot fail because a third party is down. That path is the one under
test, which is why it was built first.

Rows are selected **strictly below** the threshold. A fuzzy hit scores exactly
`0.6` and the default threshold is `0.6`, so a trigram match the snapshot
already vouched for — with an ambiguity margin — is not re-litigated by an LLM.
Only genuine failures are worth the call.

`metrics.candidates` counts how many rows were sent, so the value of enabling
Groq is measurable.

Three rules the live call obeys:

1. **Every returned value is re-resolved through the dictionary snapshot.** A
   prompt supplies the allowed vocabulary but cannot constrain the response, and
   an invented pair like `Toyota Supra` — a real vehicle, absent from this
   dictionary — would be a make/model no search facet, filter or lookup could
   ever match: worse than the unresolved value it replaced.
2. **A model is accepted only if it resolves under the repaired make**, so one
   paired with the wrong manufacturer is dropped rather than written against it.
3. **Failure degrades, never rejects.** Rows keep whatever `parseNormalize`
   determined and continue — low confidence is not invalidity. A Groq outage
   costs enrichment, not stock.

Verified against the live API: `Toyota Motor Corporation Japan` and `Merc` both
repaired to canonical makes, neither reachable by trigram matching, while
`Lamborghini` was refused by the whitelist.

### validateRows

`pipeline/validate/validate-rows.stage.ts`

The gate. Every row reaching Load passes through here, and every rejection
reason in the platform originates here.

**Two categories of check, for different reasons.**

*Business rules* mirror marketplace's `CreateListingDto`: year ∈ [1980, next
year], price > 0, mileage ≥ 0, enum membership. A vehicle a dealer could not
create through the UI must not arrive through a spreadsheet.

*Column bounds* are not pedantry. `manufacture_year` is `smallint`, `price` is
`numeric(14,2)`, `chassis_number` is `varchar(100)`. An over-long value raises
at INSERT — and **because Load batches rows, one bad value fails every good row
travelling with it.** Catching it here turns a lost batch into one rejected row.

**The intra-job duplicate check closes a silent data loss.** Two rows sharing a
registration number both upsert under `idx_vehicles_job_registration`: the
second overwrites the first, no error, no rejected record. The dealer sees
"50 loaded" for 51 rows and never learns which vanished.

A row claims its registration number only if it is *otherwise valid* — else a
rejected row would shadow a good one further down the file.

Other decisions: all problems collected per row rather than first-failure (a
dealer fixing one error per upload round-trip is the failure mode avoided);
`make is missing` and `make "Lamborghini" could not be recognised` reported
differently because they call for different fixes.

### enrich

`pipeline/enrich/enrich.stage.ts`

Runs after `validateRows`, so every row is already loadable — it only adds.
Defaults `condition = USED` (parseNormalize deliberately leaves it absent so the
default lives in exactly one findable place) and `is_negotiable = false`, then
builds `specs`.

**Body type is resolved here, and that is not cosmetic.** `buildSearchText`
reads `specs.body_type`. A bulk row without it produces a *shorter search text*
than the equivalent manual listing — and different text embeds to a different
vector. **FR-22.1 drift arriving through the side door.**

Two things dropped rather than kept:

- **Out-of-range int specs.** 200 seats is a typo; clamping to 60 invents a
  plausible-looking fact.
- **Unknown dealer columns.** `specs` is queried against `KNOWN_SPEC_KEYS`, so
  an arbitrary column is unqueryable weight that still *looks like data*.

### embed

`pipeline/embed/embed.stage.ts`

**Where model parity is enforced.**

An embedding is a 384-float vector compared by cosine distance, and a vector is
only meaningful relative to vectors built by the same model from the same-shaped
text. This stage passes exactly the 10 fields `ListingSearchIndexService` passes
for a manual listing — same order, same shared module, same `.trim()` and
empty-to-null fold.

Two tests hold this, and they hold different halves:

```
normalize-embed-parity.spec  →  our copy == marketplace's copy    (byte-identical)
embed.stage.spec             →  our usage == marketplace's usage  (same 10 fields)
```

Without both, bulk listings land in a different region of vector space and rank
badly **forever — no error, no failing test, no log line** (plan-b §9A calls
this silent drift).

A missing vector is never a row failure, matching the manual path. The row keeps
`search_text`, so the lexical half of hybrid search still finds it and a
re-embed repairs the vector later. Refusing the row could not.

The embedder is a module singleton — the ONNX model is ~90 MB, and loading it
per chunk under concurrency 10 means ten simultaneous loads. After a failure
every subsequent row skips the call rather than paying the load timeout again:
at `chunkSize` 250 that is the difference between one failure and 250.

### load

`pipeline/persistence/marketplace-vehicles-write.adapter.ts`

**The one cross-schema write in the platform.** `ingestion_service_role` holds
SELECT + INSERT + UPDATE on `marketplace.vehicles` and DELETE on neither. That
grant is the single documented exception to schema ownership (ADR-002), and the
exception is only defensible while it is confined to one class.

> **A second writer does not break a test; it dissolves the architectural claim
> the whole design rests on, silently.**

Four details that would each have been a production bug:

**The conflict target repeats the index's WHERE clause.**
`idx_vehicles_job_registration` is *partial*. A target omitting the predicate
does not match it, and Postgres raises *"no unique or exclusion constraint
matching"* — not at review, at runtime on the first upload.

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

Also: `DO UPDATE` not `DO NOTHING` (a dealer re-uploading a corrected file
expects corrections to land); status forced to `PENDING_REVIEW` (FR-33); the
embedding cast `::vector`, which pgvector requires.

---

## 4. The orchestrator

`workers/etl-worker/local-orchestrator.ts`

Transcribes SAD §6.6: same stage decomposition, same fan-out, same concurrency
bound. Only the executor differs. Deployment means thin Lambda wrappers around
the same stage objects and this flat graph transcribed into ASL.

**Chunk isolation is a correctness requirement, not resilience polish.** Every
chunk runs inside its own error boundary — that is precisely what produces
`PARTIAL` rather than `FAILED`. A dealer whose 400th row breaks the writer
should still get 399 vehicles.

| Status | Meaning |
|---|---|
| `COMPLETED` | Everything loaded, nothing rejected |
| `PARTIAL` | Some rows rejected, or a chunk failed — **a success** |
| `FAILED` | Nothing landed at all |

A header-only file is `COMPLETED` with zero counts: an empty inventory is not a
failure.

**Retry on Load alone.** Its failures are typically transient (dropped
connection, lock timeout), whereas a stage that rejected a row will reject it
identically on a second run.

**Re-runs are idempotent** because chunks already logged `SUCCEEDED` are
skipped. Rows with a null registration number miss *both* partial indexes — the
database cannot deduplicate what it has no key for, so the skip is their only
protection.

Final counts are read **from the database**, not tallied from the run. A fully
resumed run loads nothing new; tallying only this run's outcomes would report 0
loaded and downgrade a `COMPLETED` job to `FAILED` on a harmless retry.

`concurrency.ts` is 38 lines, hand-rolled — a package would be more code to
audit than to write, and one fewer thing that has to stay true when this is
replaced by ASL. It deliberately does **not** catch rejections: the
orchestrator's own boundary is what distinguishes a failed chunk from a good one.

---

## 5. Data written

### `marketplace.vehicles` (25 columns)

```
dealer_id, upload_job_id, vehicle_type, make, model, condition,
manufacture_year, registration_year, price, is_negotiable, mileage,
fuel_type, transmission_type, engine_capacity_cc, color, owners_count,
location_city, location_district, registration_number, chassis_number,
description, specs, search_text, embedding, status
```

`search_vector` is absent by design — the trigger owns it.

### `ingestion.upload_jobs`

`status`, `total_records` (set before fan-out, so a job that dies mid-flight
still shows the denominator a progress bar needs), `valid_records`,
`invalid_records`.

### `ingestion.rejected_records`

One row per rejected input row: `row_number`, `raw_data` (the original cells),
`reason` — clamped to 500 chars, because an over-long reason throws at INSERT
and takes the whole chunk's rejections with it.

### `ingestion.etl_stage_logs`

One row per stage per chunk: `stage`, `status`, `retry_count`, `metrics` jsonb,
`error_message`. `succeededChunks()` reads this to make re-runs idempotent.

---

## 6. Running it

### Setup

```bash
docker compose up -d postgres              # pgvector on host port 5433
npm --prefix database run migration:run
npm --prefix database run grants
npm --prefix database run seed:dictionaries
npm --prefix database run seed:vehicles    # creates DEALER users
```

### End to end, without an HTTP endpoint

`run-pipeline.ts` does exactly what `POST /ingest/upload` will do — store the
file, insert the job, run the pipeline — then prints the job row, the stage
logs and the rejections.

```bash
npm run build
node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv

# idempotency: re-run the same job, nothing should change
node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv --job <jobId>
```

> **Must run from `dist/`, not via tsx.** `emitDecoratorMetadata` is on, but tsx
> uses esbuild, which does not emit decorator metadata — every constructor's
> parameter types vanish and Nest cannot resolve anything.

### Generating test data

```bash
npx tsx src/tools/vehicle-generator/vehicle-generator.ts \
    --count 40 --mode mixed --output test/fixtures/e2e-mixed.csv
```

Modes: `clean`, `dirty`, `invalid`, `mixed`. Note the flags need `npx tsx`
directly — `npm run generate:vehicles --` swallows them.

### Tests

```bash
npm run test:ci            # 34 suites / 531 tests, no database needed
npm run test:integration   # 25 tests, needs the Postgres above
```

Integration tests are separate because they need a database, and they **skip
themselves** when none is reachable, so `test:ci` stays green without Docker.

They cover what no unit test can: that the partial-index `ON CONFLICT` target
actually matches, that pgvector accepts the `::vector` cast at 384 dimensions,
that `trg_vehicles_search_vector` fires, that the role holds no DELETE, and that
a re-run inserts nothing new.

---

## 7. Configuration

| Variable | Default | Notes |
|---|---|---|
| `INGESTION_DATABASE_URL` | — | Connects as `ingestion_service_role` |
| `INGESTION_PORT` | `3003` | |
| `INGESTION_STORAGE_DRIVER` | `local` | `s3` **throws** — not implemented |
| `INGESTION_STORAGE_ROOT` | `.storage` | Gitignored |
| `INGESTION_QUEUE_DRIVER` | `inprocess` | `sqs` **throws** |
| `INGESTION_MAX_CONCURRENCY` | `10` | Mirrors Step Functions MaxConcurrency |
| `INGESTION_CHUNK_SIZE` | `250` | Rows per chunk |
| `INGESTION_MAX_UPLOAD_MB` | `25` | nginx must agree — `client_max_body_size` |
| `INGESTION_GROQ_CONFIDENCE_THRESHOLD` | `0.6` | Rows strictly below go to Groq |
| `GROQ_API_KEY` | *(empty)* | Empty ⇒ stage logs `SKIPPED`, rows pass through |
| `EMBEDDING_DISABLED` | `false` | Exact string `true` only, so a typo cannot ship listings with no vector |

---

## 8. Debugging

**A job is stuck `PENDING`.** The queue handler never fired. Check
`EtlWorkerService` logged *"ETL pipeline handler registered"* at boot.

**A job is `FAILED` with one rejection at `row_number: 0`.** That is a
whole-file failure from `validateFile` — the reason names the problem (missing
columns, not UTF-8, no row separator).

**A job is `PARTIAL`.** Normal for a real dealer file. Read the reasons:

```sql
SELECT row_number, reason FROM ingestion.rejected_records
 WHERE upload_job_id = :job ORDER BY row_number;
```

**Rows loaded but do not appear in search.** Check the trigger fired and the
vector landed:

```sql
SELECT count(*) FILTER (WHERE search_vector IS NULL) AS no_vector,
       count(*) FILTER (WHERE embedding IS NULL)     AS no_embedding
  FROM marketplace.vehicles WHERE upload_job_id = :job;
```

Both should be 0 unless `EMBEDDING_DISABLED=true`.

**Everything resolves to null make/model.** The dictionary is not seeded — run
`npm --prefix database run seed:dictionaries` and check the boot log says
*"Dictionary snapshot loaded: 177 active entries"*.

**Per-stage detail:**

```sql
SELECT stage, status, chunk_id, retry_count, metrics, error_message
  FROM ingestion.etl_stage_logs
 WHERE upload_job_id = :job ORDER BY started_at;
```

---

## 9. Deployment

Deliberately deferred. The ports make it additive, not a rewrite:

1. Write `S3ObjectStore` and `SqsJobQueue` against the existing interfaces
2. Write ~5-line `src/lambda/*` wrappers around the existing stage objects
3. Transcribe the orchestrator's flat graph into Step Functions ASL

No stage function changes.

> The 13 `src/lambda/*` directories are empty, so **all Dockerfiles `CMD` into
> handlers that do not exist** — the images build but cannot cold-start. That is
> expected until the deployment phase.

---

## 10. Where the code lives

```
src/
├── config/
│   ├── database.config.ts          extra.max = 5, sized for concurrency 10
│   └── pipeline.config.ts          env → PipelineConfig
├── infrastructure/
│   ├── ports/                      ObjectStore, JobQueue
│   ├── storage/                    LocalObjectStore (path-traversal guarded)
│   └── queue/                      InProcessJobQueue
├── modules/ingestion/repositories/ upload-job, rejected-record, etl-stage-log,
│                                   dictionary, dealer-profile
├── shared/normalize-embed/         byte-identical copy of marketplace's
├── tools/run-pipeline.ts           end-to-end runner, B1's reference
└── workers/etl-worker/
    ├── local-orchestrator.ts       the graph
    ├── etl-worker.service.ts       queue → orchestrator, at boot
    └── pipeline/
        ├── types.ts                the stage contract
        ├── concurrency.ts          bounded worker pool
        ├── validate/               validate-file, validate-rows
        ├── parse/                  csv-contract, split-chunks
        ├── normalize/              coerce, enum-vocabulary, trigram,
        │                           dictionary-snapshot, parse-normalize, groq
        ├── enrich/                 enrich
        ├── embed/                  embed   ← model parity
        └── persistence/            marketplace-vehicles-write.adapter, load
```

**5,080 lines of source, 4,369 lines of test.**

---

## 11. Decisions worth remembering

| Decision | Why |
|---|---|
| Copy `normalize-embed` per service, guard with a test | A shared package breaks 7 Dockerfiles and dies when the repos split |
| Dictionary snapshot, never per-row queries | 10 concurrent chunks against a 5-connection pool |
| Ambiguity margin on fuzzy matches | A coin flip written into a dealer's inventory is worse than an unresolved value |
| Confidence = minimum, not mean | Averaging hides the one field that was wrong |
| `"3,5"` → null | Stripping that comma is a tenfold error in a price |
| Only `validateFile` may fail a job on content | Everything else has rows to reject individually |
| `validateRows` is the single gate | One place lists every rejection reason |
| One cross-schema writer class | The ADR-002 exception is only defensible while confined |
| Chunk isolation | This *is* the `PARTIAL` status |
| Retry Load only | Its failures are transient; a rejection is deterministic |
| Count from the database on finish | A resumed run loads nothing new |
