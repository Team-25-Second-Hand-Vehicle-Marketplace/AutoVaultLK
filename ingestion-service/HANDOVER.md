# HANDOVER.md
# ingestion-service — handover to Dev B 


Phase 0 (foundations) and Phase A (the ETL pipeline) are complete. This
document is what you need to build **B1 (`POST /ingest/upload`)** and
**B2 (job-status extension)** without reading the rest of the codebase first.

**The pipeline is live.** Publishing a job to the queue runs all eight stages
and writes real rows to `marketplace.vehicles`.

Full plan: `C:\Users\Admin\.claude\plans\analyse-the-full-codebase-composed-corbato.md`

---

## Start here

```bash
cd D:\Projects\AutoVaultLK
docker compose up -d postgres          # pgvector on host port 5433
npm --prefix database run migration:run
npm --prefix database run grants       # REQUIRED — see "Dealer gate" below
npm --prefix database run seed:dictionaries
npm --prefix database run seed:vehicles   # creates the DEALER users you log in as

cd ingestion-service
npm ci
npm run test:ci                        # 26 suites / 375 tests must pass
npm run test:integration               # 25 tests, needs the database above
npm run build && node dist/main.js     # listens on 3003
```

`test:integration` is separate from `test:ci` on purpose: it needs a live
Postgres and skips itself when none is reachable, so `test:ci` stays green
without Docker.

Sanity check: `GET http://localhost:3003/health` → `{"status":"ok",...}`

---

## What already exists (do not rebuild)

| Thing | Where |
|---|---|
| JWT auth: guard, strategy, `@CurrentUser`, `@Roles`, `RolesGuard` | `src/modules/auth/` |
| Job-status endpoint `GET /jobs/:id` | `src/modules/job-status/` |
| Blob storage port + local driver | `src/infrastructure/{ports,storage}/` |
| Job queue port + in-process driver | `src/infrastructure/{ports,queue}/` |
| Repositories (jobs, rejections, stage logs, dealer profile) | `src/modules/ingestion/repositories/` |
| ETL stage contract + row types | `src/workers/etl-worker/pipeline/types.ts` |
| Entities (7, incl. read-only views) | `src/infrastructure/database/entities/` |
| **The whole ETL pipeline** - 8 stages, orchestrator, queue handler | `src/workers/etl-worker/` |
| **The dealer CSV contract** - required columns, header aliases, template | `.../pipeline/parse/csv-contract.ts` |
| **The cross-schema write adapter** (inject it, do not reimplement) | `.../pipeline/persistence/` |

### The CSV header for your B5 template

Import it, do not retype it - `TEMPLATE_HEADER` in `csv-contract.ts`:

```
registration_number, make, model, year, price, mileage,
fuel_type, transmission, body_type
```

Required: `make, model, year, price, mileage`. Everything else is optional.
`registration_number` is deliberately **not** required - unregistered imports
are legitimate stock - but it is what B3 matches images on, so encourage it.

The parser also accepts ~35 header aliases (`Manufacturer`->`make`,
`YOM`->`year`, `Odometer`->`mileage`), so a dealer's own export usually works
unedited.

---

## Your interfaces

### `ObjectStore` — inject with `@Inject(OBJECT_STORE)`

```ts
put(key, body, contentType?): Promise<string>
get(key): Promise<Buffer>
getStream(key): Promise<NodeJS.ReadableStream>
exists(key): Promise<boolean>
list(prefix): Promise<string[]>
```

**Key conventions** — stick to these, the pipeline reads them:

| Key | Contents |
|---|---|
| `raw/{jobId}/{fileName}` | the dealer's CSV/JSON, immutable |
| `raw/{jobId}/{fileName}.zip` | the optional image ZIP |
| `staging/{jobId}/chunk-{n}.json` | inter-stage payloads (mine) |
| `images/{jobId}/{vehicleId}/...` | processed images (yours, B3) |

Locally these land under `ingestion-service/.storage/` (gitignored). Keys are
always relative and POSIX-style; the store **rejects** any key escaping its
root, so pass a sanitized filename, not the raw upload name.

### `JobQueue` — inject with `@Inject(JOB_QUEUE)`

```ts
publish({ jobId }): Promise<void>
```

Resolves as soon as the message is accepted — **never await the pipeline.**
Your handler must return `202 { jobId }` immediately (FR-32: the dealer polls).

### `UploadJobRepository`

```ts
create({ dealerId, fileName, csvS3Path, zipS3Path? }): Promise<UploadJob>
findById(id)            // unscoped — pipeline use
findByDealer(dealerId, limit?, offset?)
updateStatus(id, status)
updateTotal(id, totalRecords)
updateCounts(id, { validRecords, invalidRecords })
```

`create` always starts `PENDING` with zeroed counts. Don't pass counts.

### `DealerProfileRepository` — the upload gate

```ts
isVerifiedBusinessDealer(userId): Promise<boolean>
```

### `RejectedRecordRepository` / `EtlStageLogRepository`
Mostly mine, but `findForJob` on both is what B2 needs for progress and the
rejected-rows table.

---

## The upload flow you're implementing

```
POST /ingest/upload
  ├─ JwtAuthGuard + RolesGuard + @Roles('DEALER')
  ├─ DealerProfileRepository.isVerifiedBusinessDealer(user.id)  → 403 if false
  ├─ size/type check (INGESTION_MAX_UPLOAD_MB, default 25)      → 413 / 400
  ├─ ObjectStore.put('raw/{jobId}/{fileName}', ...)
  ├─ UploadJobRepository.create({...})                          → PENDING
  ├─ JobQueue.publish({ jobId })                                ← do not await pipeline
  └─ 202 { jobId }
```

---

## Five things that will bite you if you don't know them

**1. The pipeline is live — your upload really will load vehicles.**
`JobQueue.publish({ jobId })` triggers `LocalOrchestrator`, which runs all
eight stages and writes `marketplace.vehicles`. There is no placeholder any
more; the old `queue-bootstrap.service.ts` was deleted when the orchestrator
landed.

Read the terminal status correctly:

| Status | Means |
|---|---|
| `COMPLETED` | every row loaded |
| `PARTIAL` | **a success** — some rows rejected with reasons, the rest loaded |
| `FAILED` | nothing loaded: usually a malformed file, or every row invalid |

`PARTIAL` is the normal outcome for a real dealer file. It is not your bug.

To see what the pipeline does with a file before your endpoint exists:

```bash
npm run build
node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv
```

That tool does exactly what B1 must do — store the file, insert the job, run
the pipeline — then prints the job row, the stage logs and the rejections.
**It is the reference implementation for your handler.**

**2. Dealer gate needs a grant that may not be applied in your database.**
`GRANT SELECT ON auth.dealer_profiles TO ingestion_service_role` was added to
`database/src/grants.sql`. If `DealerProfileRepository` throws a permission
error, run `npm --prefix database run grants`. Verify with:
```sql
SELECT has_table_privilege('ingestion_service_role','auth.dealer_profiles','SELECT');
```

**3. `pipeline/persistence/` is mine — do not add a second writer.**
ADR-002 confines the *entire* platform's cross-schema write exception to one
class, `MarketplaceVehiclesWriteAdapter`. It is already exported from
`IngestionModule`, so inject it rather than writing SQL.

For B3 (images) you need `marketplace.vehicle_images`. That writer does not
exist yet — **ask me and I will add it to that directory.** Two writers breaks
the architectural claim the whole design rests on, and an integration test
asserts the role holds no DELETE precisely so the boundary is checked rather
than assumed.

**4. One primary image per vehicle, enforced by the database.**
`idx_vehicle_images_one_primary` is a partial unique index on
`(vehicle_id) WHERE is_primary`. A second `is_primary = true` **throws**.

**5. `@Roles('DEALER')` alone is not enough.** The contract says "business
dealer, verified" — two conditions. An `individual` dealer with `VERIFIED`
status must still be refused.

---

## Conventions

**Tests** live in `test/unit/<area>/<name>.spec.ts` mirroring `src/`. Unit tests
use plain constructor injection with `jest.fn()` literals cast `as never` — **no
`Test.createTestingModule`** (see
`test/unit/ingestion/repositories/upload-job.repository.spec.ts`). E2e tests do
use it, plus supertest, replicating `main.ts` wiring including the global
`ValidationPipe` (see marketplace-service's `test/e2e/` for the pattern).

**Env** — all `INGESTION_*` vars are documented in `.env.example`.

**Don't edit `src/shared/normalize-embed/`.** It is a deliberate byte-identical
copy of marketplace-service's, enforced by
`test/unit/shared/normalize-embed-parity.spec.ts`. See the README beside it.

**Routes** are `/ingest/upload` and `/jobs/:id` — nginx proxies both
*without* stripping the prefix, so the controller path includes it.

---

## What is NOT built yet

Everything below is yours (B1-B6) unless marked otherwise:

| | Status |
|---|---|
| `POST /ingest/upload` | **nothing exists** - no controller, dto or service |
| Job-status extension (stage progress, rejected rows) | endpoint exists, needs extending |
| Image processing (B3) | not started; needs an image write adapter from me |
| Aggregate + notify (B4) | not started |
| Dealer frontend (B5) | not started |
| `MarketplaceVehicleImagesWriteAdapter` | **mine** - ask when you reach B3 |
| Live Groq call | **mine** - the stage currently logs `SKIPPED` and passes rows through, which is correct behaviour, not a bug |
| `src/lambda/*` handlers | deferred to the deployment phase; all Dockerfiles CMD into handlers that do not exist, so no image can cold-start yet |

---

## Definition of done for B1/B2

- [ ] `POST /ingest/upload` returns `202 { jobId }` for a verified business dealer
- [ ] 401 unauthenticated · 403 non-dealer, individual dealer, unverified dealer
- [ ] 413 (or 400) over `INGESTION_MAX_UPLOAD_MB`; 400 on wrong file type
- [ ] Raw file readable at `raw/{jobId}/{fileName}` through `ObjectStore`
- [ ] `upload_jobs` row created `PENDING` with the right `dealer_id`
- [ ] `GET /jobs/:id` returns stage progress + paginated rejected rows
- [ ] A dealer cannot read another dealer's job (**404, not 403**)
- [ ] OpenAPI stubs for both routes filled in (`api-gateway/openapi/public-api.yaml`)
- [ ] `npm run test:ci`, `npm run test:e2e` and `npm run test:integration` green
- [ ] An upload of `test/fixtures/e2e-mixed.csv` through your endpoint ends
      `PARTIAL` with rows in `marketplace.vehicles` — proving the whole path
      works, not just the 202
