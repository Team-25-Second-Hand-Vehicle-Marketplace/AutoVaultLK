# Handover — Step Functions deployment and the dealer-facing surface

**For:** Virusan Thavanathan
**From:** Vishula
**Date:** 9 September 2026

Two bodies of work, independent of each other, both yours end to end:

1. **S4–S8** — finish the Step Functions migration and deploy it
2. **B1–B6** — the upload API, images, notifications and the dealer frontend

Nothing here depends on me. The two things you would otherwise have had to ask
for — the image write adapter and the CSV header — are already built and
documented below.

---

## Start here

```bash
cd D:\Projects\AutoVaultLK
docker compose up -d postgres              # pgvector on host port 5433
npm --prefix database run migration:run
npm --prefix database run grants
npm --prefix database run seed:dictionaries
npm --prefix database run seed:vehicles    # creates the DEALER users you log in as

cd ingestion-service
npm ci
npm run test:ci            # 31 suites / 478 tests must pass
npm run test:integration   # 25 tests, needs the database above
npm run build
```

Then watch the pipeline actually run:

```bash
node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv
```

40 rows in, 34 loaded, 6 rejected, job `PARTIAL`. **That tool does exactly what
B1 must do** — store the file, insert the job, trigger the pipeline — so read
it before writing your controller.

> **Everything must run from `dist/`, not tsx.** `emitDecoratorMetadata` is on
> and tsx uses esbuild, which does not emit it: every constructor's parameter
> types vanish and Nest cannot resolve anything. `npm run build` first, always.

---

## What already exists

| | Where |
|---|---|
| The whole ETL pipeline — 8 stages, orchestrator, queue handler | `src/workers/etl-worker/` |
| Ports: `ObjectStore`, `JobQueue` + local **and AWS** drivers | `src/infrastructure/{ports,storage,queue}/` |
| 9 Lambda handlers, one per stage | `src/lambda/` |
| Repositories: jobs, rejections, stage logs, dealer profile, dictionary | `src/modules/ingestion/repositories/` |
| **Both cross-schema write adapters** (vehicles + images) | `src/workers/etl-worker/pipeline/persistence/` |
| JWT auth: guard, strategy, `@CurrentUser`, `@Roles`, `RolesGuard` | `src/modules/auth/` |
| Job-status endpoint `GET /jobs/:id` | `src/modules/job-status/` |

Read these three docs, in this order:

1. **`docs/ETL-PIPELINE.md`** — what each stage does and why
2. **`docs/STEP-FUNCTIONS-MIGRATION-PLAN.md`** — the S1–S8 plan; S4 onward is yours
3. **`HANDOVER.md`** — the original B1/B2 brief, still accurate

---

# Part 1 — S4 to S8: deploy it

S1–S3 are done: stages exchange S3 pointers instead of rows, the AWS drivers
exist, and every stage has a Lambda handler. What is left is the state machine
and the infrastructure around it.

**Read `docs/STEP-FUNCTIONS-MIGRATION-PLAN.md` first** — it specifies each step,
including the reasoning. This is the summary.

## S4 — the ASL state machine

`infrastructure/step-functions/etl-state-machine.asl.json`

```
ValidateFile → SplitChunks → Map(chunks, MaxConcurrency: 10)
                               └─ ParseNormalize → GroqNormalize
                                  → ValidateRows → Enrich → Embed → Load
                             → Aggregate
```

Handlers already exist for every state — `src/lambda/<slug>.ts`, exporting
`handler`. The slug comes from `stageSlug()` in
`src/workers/etl-worker/pipeline/graph.ts`, and the Dockerfile's `CMD` is
`dist/lambda/<slug>.handler`.

**Four things to get right:**

- **`Catch` on the per-chunk chain**, routing to a pass state that emits
  `{ failed: true }`. This is what makes one bad chunk produce `PARTIAL`
  instead of failing the job — the single most important thing in the whole
  file. A dealer whose 400th row breaks the writer must still get 399
  vehicles.
- **`Retry` on `Load`**: 2 attempts, exponential backoff with jitter. It
  replaces a hand-rolled loop the in-process orchestrator still uses; the
  Lambda handler deliberately has none.
- **`Retry` on every state** for `Lambda.TooManyRequestsException` and
  `Lambda.ServiceException`.
- **`ResultPath` / `OutputPath`** so a state's output *replaces* the envelope
  rather than nesting it. Get this wrong and the next state reads
  `$.Payload.Payload.key`.

The envelope is ~200 bytes and measured at 217 in a real run, against Step
Functions' 256 KB state-payload cap. Rows never cross a boundary — that is the
whole reason S1 existed.

`Aggregate` takes `{ jobId, totalRecords, chunks }` where `chunks` is the Map's
output. See `src/lambda/aggregate-results.ts`.

## S5 — the drift guard

`graph.ts` declares the stage order once. `LocalOrchestrator` reads it; your ASL
must match it. Nothing enforces that yet, and the failure is silent in the worst
direction — local tests pass while the deployed pipeline skips a stage.

Write a test that parses the ASL JSON and asserts its Map iterator states equal
`CHUNK_STAGES` in order. `test/unit/lambda/handlers.spec.ts` does the equivalent
for handler files; follow that shape.

## S6 — connection pooling (do not skip)

**The item most likely to take production down, and the least visible in
testing** — it only appears under concurrent load.

Each Lambda container has its own pool. `MaxConcurrency: 10` × `max: 5` = **50
connections for one job**; three dealers uploading at once is 150, against a
Postgres `max_connections` that defaults to 100.

Half is already done — `src/lambda/bootstrap.ts` sets `extra: { max: 1 }`. The
other half is **RDS Proxy** in front of the database. It was listed as deferred
in the original plan; here it stops being optional.

## S7 — packaging

- **Embed → container image.** The MiniLM ONNX model is ~90 MB and a Lambda
  layer caps at 250 MB unzipped. The Dockerfile already targets
  `public.ecr.aws/lambda/nodejs:22`.
- **The other 8 → zip.** Small, fast cold starts.
- **Memory:** embed 2048 MB (Lambda scales CPU with memory and inference is
  CPU-bound), others 512 MB.
- **Timeouts:** embed 300 s, load 120 s, others 60 s.

## S8 — Terraform

The largest single piece of this handover — roughly the size of S1–S7 combined.

13 Lambda functions, IAM roles per function, the state machine, an S3 bucket
with a 7-day lifecycle on `staging/`, an SQS queue, RDS Proxy, and the
EventBridge Pipe (or trigger Lambda) that turns an SQS message into an
execution.

**Least-privilege IAM matters here.** The ingestion role's database grants are
the subject of ADR-002 and there is an integration test asserting it holds no
DELETE; the AWS-side roles should be equally tight. The embed Lambda needs no
SQS access, the validate-file Lambda needs no write access to
`marketplace.vehicles`, and so on.

---

# Part 2 — B1 to B6: the dealer-facing surface

None of this exists. `src/modules/ingestion/{controllers,dto,services}` are
empty directories.

## B1 — `POST /ingest/upload`

```
POST /ingest/upload
  ├─ JwtAuthGuard + RolesGuard + @Roles('DEALER')
  ├─ DealerProfileRepository.isVerifiedBusinessDealer(user.id)  → 403 if false
  ├─ size/type check (INGESTION_MAX_UPLOAD_MB, default 25)      → 413 / 400
  ├─ ObjectStore.put('raw/{jobId}/{fileName}', ...)
  ├─ UploadJobRepository.create({...})                          → PENDING
  ├─ JobQueue.publish({ jobId })                                ← never await the pipeline
  └─ 202 { jobId }
```

`FileFieldsInterceptor` for `file` (CSV, required) and `images` (ZIP, optional).

**`@Roles('DEALER')` alone is not enough.** The contract says "business dealer,
verified" — two conditions. An *individual* dealer with `VERIFIED` status must
still be refused.

**Read the terminal status correctly.** The pipeline is live, so a successful
upload ends `COMPLETED` or `PARTIAL`, never `FAILED`-by-default:

| Status | Means |
|---|---|
| `COMPLETED` | every row loaded |
| `PARTIAL` | **a success** — some rows rejected with reasons, the rest loaded |
| `FAILED` | nothing loaded: a malformed file, or every row invalid |

`PARTIAL` is the normal outcome for a real dealer file. It is not your bug.

Also fill in the empty `/ingest/upload` schema in
`api-gateway/openapi/public-api.yaml` (multipart body, 202/400/401/403/413).

## B2 — extend `GET /jobs/:id`

The endpoint exists. Add per-stage progress from `ingestion.etl_stage_logs` and
a paginated `rejected_records` slice (`rowNumber`, `reason`, raw row).

`RejectedRecordRepository.findForJob` and `EtlStageLogRepository.findForJob`
already return what you need.

Keep the existing posture: **a dealer reading another dealer's job gets 404, not
403** — a 403 confirms the job exists.

## B3 — image processing

**The adapter you need is already built:**
`MarketplaceVehicleImagesWriteAdapter`, exported from `IngestionModule`. Inject
it; do not write `marketplace.vehicle_images` yourself. ADR-002 confines every
cross-schema write in the platform to that directory, and an integration test
asserts the role holds no DELETE.

```ts
insertForVehicle(vehicleId, images, primaryIndex = 0): Promise<InsertedImage[]>
vehicleIdsByRegistration(jobId): Promise<Map<string, string>>
countForJob(jobId): Promise<number>
```

Three things that will bite you:

- **One primary image per vehicle, enforced by the database.**
  `idx_vehicle_images_one_primary` is a partial unique index on
  `(vehicle_id) WHERE is_primary`; a second `is_primary = true` raises 23505
  and takes the statement with it. The adapter handles this — `primaryIndex`
  names the primary and forces every other row false — but do not work around
  it.
- **Match by canonical registration number.** `vehicleIdsByRegistration`
  returns keys in the form `coerceRegistrationNumber` produces (`CAB-1234`), so
  fold a filename through that function before looking it up or `cab1234.jpg`
  will miss. It is in `pipeline/normalize/coerce.ts`.
- **Zip-slip.** Every ZIP entry name is attacker-controlled. `LocalObjectStore`
  rejects keys that escape its root, but check the entry name before you build
  a key from it.

Unmatched images are reported, never fatal.

## B4 — aggregate and notify

`AGGREGATE` is done — `src/lambda/aggregate-results.ts`. What is missing is
`NOTIFY`: an internal HTTP call using `NOTIFICATION_INTERNAL_URL` and
`INTERNAL_SERVICE_KEY`, plus an upload-summary template in
notification-service.

Failure here must **degrade, never fail the job** — the data is already loaded,
and a dealer who got their vehicles should not see `FAILED` because an email
did not send.

## B5 — the dealer frontend

- `web-frontend/src/api/ingestion.api.ts` + `ingestion.types.ts` — mirror
  `admin.api.ts`
- `BulkUploadPage.tsx` — file picker, optional image ZIP, client-side size check
- `UploadStatusPage.tsx` — polls `GET /jobs/{jobId}` every ~3 s with backoff,
  stops on a terminal status, shows a rejected-rows table

Use the existing `sonner` / react-hook-form + zod conventions.

**The CSV template header** — import it, do not retype it. `TEMPLATE_HEADER` in
`src/workers/etl-worker/pipeline/parse/csv-contract.ts`:

```
registration_number, make, model, year, price, mileage,
fuel_type, transmission, body_type
```

Required: `make, model, year, price, mileage`. `registration_number` is
deliberately **not** required — unregistered imports are legitimate stock — but
it is what B3 matches images on, so encourage it.

The parser also accepts ~35 header aliases (`Manufacturer`→`make`,
`YOM`→`year`, `Odometer`→`mileage`), so a dealer's own export usually works
unedited. Say so in the UI; it saves support tickets.

## B6 — tests

- `test/e2e/ingest-upload.e2e-spec.ts` — unauthenticated 401, non-dealer 403,
  individual dealer 403, unverified dealer 403, oversize 413, happy path 202
- `test/e2e/job-status.e2e-spec.ts` — ownership 404, response shape
- `test/unit/pipeline/image-processing/` — registration matching, the
  single-primary invariant, zip-slip

Follow marketplace-service's `test/e2e/` pattern: real `Test.createTestingModule`
plus supertest, replicating `main.ts` wiring including the global
`ValidationPipe`.

---

## Conventions

**Tests** live in `test/unit/<area>/<name>.spec.ts` mirroring `src/`. Unit tests
use plain constructor injection with `jest.fn()` literals cast `as never` —
**no `Test.createTestingModule`**. See
`test/unit/ingestion/repositories/upload-job.repository.spec.ts`.

Three suites, and they are separate on purpose:

```bash
npm run test:ci            # 31 suites / 478 tests, no database
npm run test:integration   # 25 tests, needs Postgres; skips itself without one
npm run test:e2e           # yours to fill
```

**`npm run build` is the real typecheck.** `tsc --noEmit` uses different
settings and has already let one error through that `nest build` caught.

**Do not edit `src/shared/normalize-embed/`.** It is a byte-identical copy of
marketplace-service's, enforced by
`test/unit/shared/normalize-embed-parity.spec.ts`. Changing it invalidates every
stored embedding and requires editing both copies plus a re-seed. The README
beside it explains the procedure.

**Routes** are `/ingest/upload` and `/jobs/:id` — nginx proxies both *without*
stripping the prefix, so the controller path includes it.

**Env** — every `INGESTION_*` variable is documented in `.env.example`.

---

## Definition of done

**S4–S8**
- [ ] A file uploaded through the gateway runs end to end on AWS and ends `PARTIAL`
- [ ] One failing chunk yields `PARTIAL`, not `FAILED`
- [ ] Re-running an execution inserts no duplicate rows and no duplicate rejections
- [ ] `GROQ_NORMALIZE` logs `SKIPPED` with no key; the job still completes
- [ ] RDS Proxy in place and connection count stable under 3 concurrent uploads
- [ ] `terraform apply` builds the stack from nothing

**B1–B6**
- [ ] `POST /ingest/upload` returns `202 { jobId }` for a verified business dealer
- [ ] 401 unauthenticated · 403 non-dealer, individual dealer, unverified dealer
- [ ] 413 over `INGESTION_MAX_UPLOAD_MB`; 400 on wrong file type
- [ ] `GET /jobs/:id` returns stage progress and paginated rejected rows
- [ ] A dealer cannot read another dealer's job (**404, not 403**)
- [ ] Images match vehicles by registration number; exactly one primary each
- [ ] Frontend uploads, polls, and shows rejected rows with reasons
- [ ] OpenAPI stubs filled in for both routes
- [ ] All three test suites green

---

## The one thing I would ask

`pipeline/persistence/` holds both cross-schema write adapters, and ADR-002's
exception is only defensible while every write to `marketplace.*` goes through
them. Adding a repository elsewhere does not break a test — it dissolves the
architectural claim silently. If you need a write that is not there, add a
method to the adapter rather than a new writer.

Everything else, change freely.
