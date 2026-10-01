# ingestion-service - Architecture & Flow Report

**Scope:** `ingestion-service/` - bulk dealer inventory upload and the ETL pipeline.
Owns the `ingestion` schema; holds the platform's only cross-schema write grant.
Written from the source as of 2026-09-28 (branch `main`).

---

## 1. What this service is

Three things in one deployable:

1. **An upload API** - `POST /ingest/upload` takes a dealer's CSV (plus an optional
   ZIP of photos), stores both, creates a job row, publishes to a queue, and returns
   `202 Accepted` immediately.
2. **An ETL pipeline** - eleven stages that turn raw CSV cells into rows in
   `marketplace.vehicles`, with per-field provenance, dictionary normalisation, an
   LLM repair pass, 384-dim embeddings, and image matching.
3. **A job-status API** - `GET /jobs/:id`, `/jobs/active`, `/jobs/:id/rejections`,
   backing the dealer's progress bar and row-level error report.

The pipeline has **two executors running identical stage code**: `LocalOrchestrator`
(in-process) and an AWS Step Functions state machine invoking one Lambda per stage.

### The architectural rule everything rests on (ADR-007)

> A stage is a plain object with a `run` method. It must **not** import NestJS, must
> **not** import an AWS SDK, and must **not** open a database connection except
> through a port handed to it in `StageContext`.

That constraint is what lets the same code run under both executors. Deployment meant
writing thin Lambda wrappers, not changing stages.

### The second rule (the one that shapes error handling)

> **A stage never throws because a row is bad.** Bad rows come back as `rejections`
> and travel with the batch. Only infrastructure failure throws.

`PARTIAL` job status and per-row `ingestion.rejected_records` fall out of this
naturally instead of needing special-casing at every level. There is exactly **one**
deliberate exception: `validateFileStage` may throw `FileValidationError`, because a
file with no header row has no rows to reject.

---

## 2. Entry points & configuration

| Entry point | File | Role |
|---|---|---|
| HTTP server | `src/main.ts` | port `INGESTION_PORT` → `3003` |
| Ingest API Lambda | `src/lambda/ingest-api.ts` | `/ingest/*`, `/jobs/*` |
| Job-status Lambda | `src/lambda/job-status-api.ts` | uses the slimmer `job-status-app.module.ts` |
| 14 stage Lambdas | `src/lambda/*.ts` | one per Step Functions state |

`INGESTION_PORT` is read before `PORT` because `.env.example` sets `PORT=3001`
globally for auth-user-service. Unlike marketplace, **no path-prefix stripping is
needed** - controllers are already `@Controller('ingest')` / `@Controller('jobs')`,
matching the gateway route keys exactly.

### `src/config/pipeline.config.ts`

| Setting | Env var | Default |
|---|---|---|
| `maxConcurrency` | `INGESTION_MAX_CONCURRENCY` | 10 (mirrors the ASL Map state) |
| `chunkSize` | `INGESTION_CHUNK_SIZE` | 250 |
| `groqConfidenceThreshold` | `INGESTION_GROQ_CONFIDENCE_THRESHOLD` | 0.6 |
| `embeddingDisabled` | `EMBEDDING_DISABLED` | exact string `'true'` only |

Parsing is defensive: a non-positive or unparseable concurrency/chunk size falls back
to the default (0 would stall rather than fail loudly), confidence must be in [0,1],
and `EMBEDDING_DISABLED` matches only the exact lowercase string so a typo like
`TRUE` cannot silently ship vectorless listings.

### `src/config/database.config.ts`
Schema `ingestion`, `synchronize: false`, **`extra: { max: 5 }`**. That pool size is
sized on the assumption that the dictionary is loaded *once per run*, not per row -
several comments across the codebase reference this as the reason a per-row
dictionary query would be a design violation, not just a slowdown.

---

## 3. Infrastructure ports (`src/infrastructure/`)

Two hexagonal ports, each with a local and an AWS driver, selected by env var.

### `ObjectStore` (`ports/object-store.port.ts`)
`put` / `get` / `getStream` / `exists` / `list`. Key layout:

```
raw/{jobId}/{fileName}             immutable dealer upload
staging/{jobId}/chunk-{n}.json     inter-stage payloads (~7-day S3 lifecycle)
images/{jobId}/{vehicleId}/...     processed images + thumbnails
```

Keys derive from dealer-supplied filenames, so `LocalObjectStore` **must** reject any
key escaping its root. `getStream` exists specifically so a 25MB CSV and a 250MB ZIP
are never buffered whole.

### `JobQueue` (`ports/job-queue.port.ts`)
`publish(message)` must resolve when the message is *accepted*, not when the pipeline
finishes - that is what makes the 202 honest. The message is **deliberately just
`{ jobId }`**: the pipeline re-reads the job row rather than trusting a payload, so a
redelivered or replayed message cannot resurrect stale values.

### Driver selection - fail loud, never fall back
Both `StorageModule` and `QueueModule` **throw on an unknown driver** rather than
defaulting to local. The reasoning is explicit: a half-configured deployment silently
writing dealer uploads to a container's ephemeral disk - with the job row still
claiming success - is worse than a boot failure. `S3ObjectStore` validates its bucket
at construction, so a missing `INGESTION_S3_BUCKET` fails at boot, not on first upload.

`EtlWorkerService` registers an in-process handler **only** when
`INGESTION_QUEUE_DRIVER=inprocess`. Under `sqs`, Step Functions owns execution, and
registering a handler too would run every job twice with two writers racing.

---

## 4. Domain model (`src/infrastructure/database/entities/`)

Owned (read-write, `ingestion` schema):

| Entity | Purpose |
|---|---|
| `UploadJob` | `PENDING → PROCESSING → COMPLETED \| PARTIAL \| FAILED`, plus `totalRecords` / `validRecords` / `invalidRecords` and the two storage paths |
| `EtlStageLog` | One row per stage per chunk per attempt: status, `retryCount`, timings, `errorMessage`, `metrics jsonb` |
| `RejectedRecord` | `stage` + `rowNumber` + `rawData jsonb` + `reason`. `rowNumber = 0` means the whole file |

`EtlStageStatus` is five-valued: `STARTED | SUCCEEDED | FAILED | SKIPPED | DEGRADED`.
`DEGRADED` is what makes "Groq was down but the rows still loaded" expressible.

`RejectedRecord.stage` is part of the idempotency key: under Step Functions each stage
is its own Lambda and ASL retries states, so a stage must be able to replace *its own*
rejections rather than duplicate them (migration 26000).

Read-only views: `AuthUserView`, `DealerProfileView`, `VehicleDictionaryView`.
Write entities (the cross-schema exception): `VehicleWriteEntity`,
`VehicleImageWriteEntity`.

---

## 5. Upload API (`src/modules/ingestion/`)

`POST /ingest/upload` - `@Roles('DEALER')`, `202 Accepted`, multipart with `csv`
(required) and `zip` (optional).

`IngestionUploadService.upload()`:

1. **`verifyDealer`** - `isVerifiedBusinessDealer(dealerId)`. Only **verified business**
   dealers may bulk upload. Manual listing creation (marketplace-service) is open to
   verified dealers of any type, including business dealers - a business dealer may use
   either or both paths; bulk upload is not their only option, just an additional one.
2. **Validate the CSV** - non-empty, ≤25MB, `.csv` extension, MIME in an allowlist.
   Extension *and* MIME are both checked; the browser-supplied MIME alone is not trusted.
3. **Validate the ZIP** if present - non-empty, ≤250MB, `.zip`, MIME allowlist.
4. **Create the job row first**, so storage keys can be tied to a stable job id.
5. Write `raw/{jobId}/{safeName}` for each file, then update the job's paths.
6. **Publish `{ jobId }`** and return.

On any failure after job creation the job is marked `FAILED` and the caller gets a
500 - the job row is never left dangling in `PENDING`.

> **Note:** the size limits here are hardcoded class fields (25MB / 250MB), while
> `pipeline.config.ts` exposes `maxUploadBytes()` reading `INGESTION_MAX_UPLOAD_MB`.
> The service does not use that helper, so the env var has no effect on CSV size.

---

## 6. The pipeline (`src/workers/etl-worker/`)

### 6.1 The graph, declared once (`pipeline/graph.ts`)

```
FILE_STAGES      VALIDATE_FILE → SPLIT_CHUNKS
                        │
        ┌───────────────┴────────────────┐
        │  Map (MaxConcurrency 10)       │  Parallel branch
        ▼                                ▼
CHUNK_STAGES                        IMAGE_STAGES
  PARSE_NORMALIZE                     PROCESS_IMAGES
  GROQ_NORMALIZE
  VALIDATE_ROWS
  ENRICH
  EMBED
  LOAD
        └───────────────┬────────────────┘
                        ▼
FINALIZE_STAGES   AGGREGATE → NOTIFY
```

Both executors read these arrays, and a test asserts the ASL definition's states match
them in order - so adding a stage to one without the other fails the build rather than
a dealer's upload. `stageSlug()` derives Lambda directory names and ASL state names
from the same constant, giving each stage exactly one spelling.

**Chunk stage order is load-bearing, not cosmetic:**
- `GROQ_NORMALIZE` follows `PARSE_NORMALIZE`, which assigns the confidence it selects on.
- `VALIDATE_ROWS` follows both, so a Groq repair gets a chance before the gate.
- `ENRICH` precedes `EMBED`, because `buildSearchText` reads `specs.body_type` - a row
  embedded before enrichment would produce different text from the manual path (FR-22.1).
- `LOAD` is last and terminates the chain.

**Images run in parallel with the chunk Map, not after it.** Photos depend on nothing
in the text pipeline, so concurrency cuts wall-clock time. The cost: a vehicle row may
not exist yet when its photo is ready to match - which is exactly why the image
matcher retries (§6.9).

### 6.2 `VALIDATE_FILE` - the only stage allowed to fail a job on content

Checks, in order: `.csv` extension → object exists → non-empty → UTF-8 decodable →
parseable header line → no duplicate headers → all `REQUIRED_COLUMNS` present → (if a
ZIP was uploaded) archive structure.

Deliberate details:
- **Reads only the first 64KB**, not the whole object - a check that only looks at
  line one should not buffer a 25MB file, ten at a time.
- **Strips the UTF-8 BOM.** Excel writes one, making `make` miss an exact comparison
  in a way invisible in every editor.
- A "header line" over 64KB means the file is not delimited as expected - almost
  always an XLSX saved with a `.csv` extension.
- **ZIP guards:** ≤2000 entries and ≤2GB declared uncompressed size, checked *before*
  extraction - a zip-bomb defence. A malformed archive fails the whole job with one
  clear message rather than surfacing as an "images failed" footnote after rows loaded.

### 6.3 The CSV contract (`pipeline/parse/csv-contract.ts`)

A shared boundary read by three consumers: `validateFile`, `splitChunks`, and the
dealer-facing downloadable template.

- **`REQUIRED_COLUMNS` (11)** - `make`, `model`, `year`, `price`, `mileage`,
  `fuel_type`, `transmission`, `color`, `engine_capacity_cc`, `owners_count`,
  `location_district`. The last six were widened from optional per an SRS update: a
  listing missing any was judged too thin for a buyer to evaluate.
- **`registration_number` is *not* required** - unregistered imports are legitimate
  stock - but it is the key the image matcher uses.
- **`vehicle_type` is not required** either; it falls back to dictionary derivation,
  then the schema default `CAR`.
- **`KNOWN_COLUMNS`** adds spec columns and category-gated columns (bike stroke type,
  van roof type, truck axle count…). An **unknown column is not an error** - dealers
  export from their own DMS - it is appended to the description by `ENRICH` rather
  than dropped.
- **`HEADER_ALIASES`** folds ~40 real-world spellings (`Manufacturer`→`make`,
  `odometer`/`km`/`kilometers`→`mileage`, `yom`→`year`, `reg_no`→`registration_number`).

### 6.4 `SPLIT_CHUNKS`

Streams the CSV and flushes `staging/{jobId}/chunk-NNN.json` every `chunkSize` rows.
A 25MB upload therefore costs one chunk of memory, not 25MB - and under concurrency 10
that difference *is* the worker's footprint.

- `relaxColumnCount: true` - a ragged line is a *row* defect; without it csv-parse
  aborts the whole stream.
- Rows of entirely empty cells are skipped silently as trailing spreadsheet noise.
- Every value stays a **string**; coercion belongs to `PARSE_NORMALIZE`, which can
  attach a per-field confidence and a rejection reason.
- Chunk files are the **unit of retry** - the orchestrator skips chunks already logged
  `SUCCEEDED`.

### 6.5 `PARSE_NORMALIZE` - typing, dictionary resolution, provenance

Two rules stated in the file header:

1. **It never rejects a row** - even a row with no make passes through with low
   confidence, so Groq still gets a chance. `VALIDATE_ROWS` is the single gate.
2. **Row confidence is the *minimum* across filled-in fields, not the mean.** A row
   whose make resolved exactly but whose model is unrecognised is not 80% correct; it
   is wrong in the field that matters.

Blank *optional* fields score `NEUTRAL = 1.0` and are excluded from provenance -
scoring a blank `color` as a miss would drag every row below the Groq threshold and
send whole files to an LLM with nothing to work with.

**`DictionarySnapshot`** (`normalize/dictionary-snapshot.ts`) is an in-memory view of
`marketplace.vehicle_dictionaries` built **once per run**. Resolution is exact → alias
→ fuzzy, mirroring marketplace's search parser so both halves fold the same dealer
input to the same canonical value:

| Match | Confidence |
|---|---|
| Exact canonical | 1.0 |
| Alias | 0.8 |
| Fuzzy (trigram) | 0.6 - exactly on the Groq threshold |
| Unresolved | 0 |

Shared constants with marketplace-service: `TRIGRAM_THRESHOLD = 0.45`,
`AMBIGUITY_MARGIN = 0.05`, `MIN_FUZZY_PROBE_LENGTH = 4`. Models resolve **scoped to
their parent make** - a "Civic" must not resolve when the row's make is Toyota - and a
null make means the model cannot be trusted either.

**Provenance (FR-42.1)** records per field `{source, confidence, reasoning?}` where
source is `rule | dictionary | raw | groq`. This is written into
`marketplace.vehicles.normalization` and is what lets the dealer review UI say
"we inferred PICKUP from the Hilux model".

### 6.6 `GROQ_NORMALIZE` - the LLM fallback

Only rows below the confidence threshold are candidates. Three guarantees:

1. **The keyless path is required behaviour, not a fallback.** With `GROQ_API_KEY`
   unset the stage logs `SKIPPED` and rows pass through untouched - which is exactly
   what a Groq outage produces. CI has no key.
2. **Every returned value is checked against the dictionary snapshot.** An LLM
   inventing "Toyota Supra" - a real vehicle absent from this dictionary - would write
   a pair no search facet, filter or lookup can ever match. Worse than the unresolved
   value it replaced.
3. **Failure degrades, never rejects.** Rows keep their deterministic values and
   continue; the stage logs `DEGRADED`.

**`GROQ_BATCH_SIZE = 8`, sent sequentially.** A whole chunk's candidates (up to 250) in
one request routinely blew Groq's free-tier 8,000 TPM limit once the ~30-make
vocabulary was included - observed as a 413 on chunk one and a 429 on chunk two.
Parallel sub-batches would recreate the same ceiling, so they are deliberately serial.

Repaired fields are marked `source: 'groq'`, with `reasoning` stored only when Groq
actually changed a value and supplied one.

### 6.7 `VALIDATE_ROWS` - the single gate

Every rejection reason in the platform originates here. Two categories:

1. **Business rules** mirroring marketplace's `create-listing.dto.ts`, so a dealer
   cannot bulk-upload a vehicle they could not have created through the UI.
2. **Column bounds** - smallint ranges, varchar lengths, `numeric(14,2)` precision.
   Not pedantry: an over-long `make` raises at INSERT time, and because Load *batches*,
   one such value would fail every good row travelling with it. Catching it here turns
   a lost batch into one actionable rejected row.

**Intra-job duplicate registration numbers are caught here**, before fan-out. Two rows
sharing a registration would upsert over each other under
`idx_vehicles_job_registration` - the second silently overwriting the first, with no
error and no rejected record. The dealer would see "50 loaded" for 51 rows and never
learn which vanished. Only a row that will actually load claims the number, so a
rejected row cannot shadow a good one further down the file.

### 6.8 `ENRICH`

Fills `specs jsonb`, status and defaults. Its discipline: **a spec key nothing can
filter on is worse than an absent one, because it looks like data.**

- `body_type` must be one of ten values matching marketplace's `KNOWN_SPEC_KEYS` and
  the dictionary seed; anything else is dropped, not stored.
- **Category-gated specs** (SRS Appendix B.2): `CAR/SUV` get `seats`/`doors`/`airbags`;
  `BIKE` gets `stroke_type`/`cooling_system`/`start_type`/`abs_equipped`; `VAN/BUS` get
  `seating_capacity`/`roof_type`/`wheelbase`/`door_configuration`; `TRUCK/LORRY/PICKUP`
  get `load_capacity_kg`/`payload_capacity_kg`/`axle_count`/`cargo_bed_type`. A truck's
  `axle_count` on a car row is ignored, not stored.
- **Universal equipment booleans** are the deliberate exception (a van can have a
  sunroof too): `sunroof`, `full_option`, `alloy_wheels`, `reverse_camera`,
  `leather_seats`, `power_steering`, `air_conditioning` - each with dealer-spelling
  aliases (`ac`, `alloys`, `fulloption`, `backup_camera`…).
- Sets `needs_manual_review` / `review_reason` (FR-35.2) when a row has no registration
  number and therefore can get no automated image match.
- Unknown columns are appended to the description.

### 6.9 `EMBED`

Builds `search_text` and the 384-dim vector using the **shared `normalize-embed`
module, byte-identical to marketplace-service's copy**. This is where FR-22.1 /
NFR-26.1 parity is enforced, guarded by two tests: a byte-identity parity test on the
shared module, and a test asserting this stage's text matches what the manual listing
path produces for an equivalent vehicle.

The ~90MB ONNX model is a **module singleton** - under concurrency 10, a per-chunk
load would mean ten simultaneous model loads.

`EMBEDDING_DISABLED=true` still builds `search_text`, so the trigger-maintained
`search_vector` is populated and lexical search keeps working. A missing vector is
**never a row failure** - it matches the manual path, and a re-embed can repair it
later; refusing the row could not.

### 6.10 `LOAD` - the one cross-schema write in the platform (ADR-002)

`MarketplaceVehiclesWriteAdapter` carries a banner comment worth quoting:

> `ingestion_service_role` holds SELECT + INSERT + UPDATE on `marketplace.vehicles`
> and `marketplace.vehicle_images` - and DELETE on neither. **No other file in
> ingestion-service may write `marketplace.*`.** A second writer does not break a
> test; it dissolves the architectural claim the whole design rests on, silently.

Strategy: **batch insert, then isolate on conflict.** A chunk of 250 is one statement
in the common case; a unique violation triggers a per-row retry to find the actual
culprit, because a batch INSERT aborts entirely on first violation and would lose the
249 good rows. The isolated failure becomes one rejection -
`registration_number X is already listed` - from the *global* partial unique index
(FR-35.1, migration 6000), which the `ON CONFLICT` target cannot catch because job ids
differ.

Rows are written with `status = 'PENDING_REVIEW'` and the `normalization` provenance
blob. **Load is the only retried stage** (2 attempts, 250ms apart): its failures are
typically transient, whereas a stage that rejected a row will reject it identically.

**Idempotency caveat:** rows with a null registration number miss *both* partial unique
indexes, so they can neither conflict nor upsert - a re-run would insert them twice.
That is why the orchestrator skips chunks already logged `SUCCEEDED` rather than
relying on the database; for these rows there is nothing to deduplicate against.

### 6.11 `PROCESS_IMAGES` - the parallel branch

`extract-images.stage.ts` opens the ZIP **in memory, never writing to local disk**,
rejects path-traversal entries (`/`, `../`, `..\`), filters to
`jpg/jpeg/png/webp`, and derives a registration number from each filename's base name.

`ProcessJobImagesService` then, per image: find the vehicle by registration number →
process (resize/thumbnail via `sharp`) → store under `images/{jobId}/{vehicleId}/` →
insert a `vehicle_images` row.

**The retry budget is the interesting part.** Because images run concurrently with the
Map, the target row may not be loaded yet. The lookup retries for **30s at 500ms
intervals**, so the match self-corrects once the row lands - no staging table, no
post-Map reconciliation join. Only a row that was genuinely rejected ends up truly
unmatched.

Outcomes are counted as `processed | unmatched | duplicates | failed`; any
unmatched or failed image makes the stage `DEGRADED`, never failed.

### 6.12 `AGGREGATE` and `NOTIFY`

**Aggregate** counts what actually landed by querying
`marketplace.vehicles WHERE upload_job_id = $1` rather than tallying this run's
outcomes - because a *resumed* run loads nothing new, and tallying would report zero
and wrongly downgrade a finished job to `FAILED`. Status resolution:

```
loaded === 0                        → FAILED
anyChunkFailed || rejected > 0      → PARTIAL
otherwise                           → COMPLETED
```

**Notify** runs last, after every row is already written, and that ordering licenses
its failure posture: an unreachable notification service must not fail the job, or a
dealer would re-upload work that already landed. No key configured → `SKIPPED`; send
failed → `DEGRADED` with a reason.

Two details: `PARTIAL` maps to `UPLOAD_COMPLETED` (not `UPLOAD_FAILED`) because the
intake vocabulary has only two values and a mostly-loaded job is far closer to
completed - the counts in the payload carry the nuance. And the idempotency key
`upload-{status}-{jobId}` is deterministic, so a Step Functions retry re-sends the
same key rather than mailing the dealer twice.

---

## 7. Orchestration

### 7.1 `LocalOrchestrator`

Transcribes the Step Functions state machine exactly; only the executor differs.

```
load job row → status PROCESSING
  → loadSnapshot()                     (once, never per row)
  → VALIDATE_FILE → SPLIT_CHUNKS
  → updateTotal()                      (before fan-out, so the progress bar has a denominator)
  → succeededChunks() → skip set       (resume support)
  → Promise.all([
        mapWithConcurrency(chunks, 10, runChunk),
        processImages()
     ])
  → AGGREGATE → NOTIFY
```

**Chunk isolation is a correctness requirement, not resilience polish.** Each chunk
runs inside its own error boundary; a chunk that throws is *reported*, not rethrown.
That is precisely what produces `PARTIAL` rather than `FAILED` - a dealer whose 400th
row breaks the embedder should still get 399 vehicles.

A header-only file is `COMPLETED` with zero counts, not a failure - the dealer uploaded
an empty inventory, and that is the honest outcome.

### 7.2 The Step Functions path

14 handlers in `src/lambda/`, each a thin wrapper. `run-chunk-stage.ts` is the shared
body for every per-chunk handler - three lines around one call, deliberately: *the
Lambda boundary should add packaging, not behaviour.*

Errors **propagate** there, unlike in the local orchestrator: ASL's `Retry` and `Catch`
handle them, and a handler that swallowed a failure would return a well-formed envelope
claiming success while the state machine carried on with rows that were never written.

Stage logs are written per *invocation* rather than per job, so a retried state gets
its own row - a silent retry would otherwise look like a stage that simply took longer.

> **Known gap, documented in `local-orchestrator.ts`:** the ASL definition
> (`infrastructure/step-functions/etl-state-machine.asl.json`) has **no
> `PROCESS_IMAGES` state at all**. The parallel image branch exists only in the local
> executor; adding it as a true Parallel state is outstanding work on the Lambda path.

---

## 8. Job-status API (`src/modules/job-status/`)

`@UseGuards(JwtAuthGuard)` at class level. Route is `jobs`, not `upload-jobs`, because
nginx proxies `location /jobs/` **without** stripping the prefix.

| Route | Purpose |
|---|---|
| `GET /jobs/active` | Latest active job for the dealer, or `null`. Declared before `:id`. |
| `GET /jobs/:id` | Job row + counts + every stage log |
| `GET /jobs/:id/rejections` | FR-57 row-level report, paginated |

Every query is **dealer-scoped**, so "not yours" and "does not exist" are
indistinguishable to a caller probing ids. A job with no rejections is an empty page,
not a 404 - a clean upload is the expected case, and a 404 would read as "your job is
gone".

`rawData` is capped at 24 keys per rejection with a `truncated` flag: the report exists
to point at the value needing correction, and a 60-column export would make the
response mostly payload nobody reads.

---

## 9. Tooling (`src/tools/`)

| Tool | Purpose |
|---|---|
| `vehicle-generator/` | Generates CSV fixtures; **column names match `csv-contract.ts` by construction**, so generated files are valid uploads |
| `image-generator/` | Generates matching photo ZIPs |
| `ingestion-tester/` + `report.ts` | Drives an end-to-end run and reports |
| `run-pipeline.ts` | Runs the pipeline directly against a job id |

---

## 10. Testing

40 spec files: `test/unit/` (mirroring the pipeline tree), `test/integration/`,
`test/contract/`, `test/e2e/`. Per `HANDOVER.md`: **34 suites / 531 tests** for
`test:ci`, plus 25 integration tests needing live Postgres.

`test:integration` is separate on purpose - it skips itself when no database is
reachable, keeping `test:ci` green without Docker.

Notable guards:
- `test/unit/shared/normalize-embed*` - byte-identity parity with marketplace-service.
- `test/unit/step-functions/*` - asserts the ASL state list matches `graph.ts` in order.

---

## 11. End-to-end flow: a dealer's bulk upload

```
1.  Dealer POSTs inventory.csv + photos.zip
      → JWT verified, role DEALER, verified BUSINESS dealer
      → files size/extension/MIME checked
      → UploadJob row (PENDING) → raw/{jobId}/… in ObjectStore
      → publish({jobId}) → 202 { jobId, status: 'PENDING' }

2.  Queue handler (in-process) or SQS → Step Functions
      → status PROCESSING
      → DictionarySnapshot loaded once

3.  VALIDATE_FILE    extension, BOM, header, required columns, ZIP sanity
    SPLIT_CHUNKS     streamed → staging/{jobId}/chunk-000.json …
                     → updateTotal(totalRecords)

4.  Map over chunks (≤10 concurrent)   ║  Parallel: PROCESS_IMAGES
      PARSE_NORMALIZE  types + dict    ║    unzip in memory (traversal-guarded)
                       + provenance    ║    per image: find vehicle by reg no
      GROQ_NORMALIZE   low-conf rows   ║      (retry ≤30s - row may still be loading)
                       whitelisted     ║    sharp → resize + thumbnail
      VALIDATE_ROWS    THE gate        ║    → images/{jobId}/{vehicleId}/…
      ENRICH           specs, gating   ║    → vehicle_images row
      EMBED            MiniLM 384-d    ║
      LOAD             batch upsert    ║
                       → marketplace.vehicles (PENDING_REVIEW)

5.  AGGREGATE   count actual rows → COMPLETED | PARTIAL | FAILED
    NOTIFY      UPLOAD_COMPLETED / UPLOAD_FAILED, idempotency-keyed

6.  Dealer polls GET /jobs/{id} → counts + per-stage progress
                GET /jobs/{id}/rejections → row, reason, original cells

7.  Rows are invisible to buyers until the dealer approves them in
    marketplace-service (PATCH /listings/:id/approve). See report 01 §12.D.
```

---

## 12. Observations worth a maintainer's attention

1. **The ASL state machine has no `PROCESS_IMAGES` state.** The deployed Lambda path
   therefore does not process images at all; only `LocalOrchestrator` does. This is
   acknowledged in code comments as outstanding work.
2. **Upload size limits are hardcoded** in `IngestionUploadService` (25MB / 250MB)
   while `pipelineConfig`'s `maxUploadBytes()` / `INGESTION_MAX_UPLOAD_MB` exists but
   is never called - the env var silently does nothing.
3. **`ProductionExceptionFilter` is registered in `main.ts` but not in
   `lambda/ingest-api.ts`** - the same local-vs-deployed divergence as
   marketplace-service.
4. **Deleted documentation.** `git status` shows `docs/ETL-PIPELINE.md`,
   `docs/HANDOVER-VIRUSAN.md`, `docs/PHASE-A-REPORT.md` and
   `docs/STEP-FUNCTIONS-MIGRATION-PLAN.md` deleted but not committed, while root
   `HANDOVER.md` still tells readers to "start with `docs/HANDOVER-VIRUSAN.md`".
5. **Stray log files committed at the service root:** `groq-test-fresh.log`,
   `groq-test-v2.log`, `groq-test-v3.log`.
6. **The 30-second image match retry budget is per image, serially.** A ZIP with many
   genuinely unmatched photos (e.g. all registration numbers rejected) pays 30s each.
7. **Shared code is duplicated by design, not by accident** - `normalize-embed/`,
   `trigram.ts`, `csv-contract.ts` parallels, and the confidence/ambiguity constants
   are all hand-synced with marketplace-service. Parity tests cover the embed module;
   the threshold constants rely on comments and one parity test.
