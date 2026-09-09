# Handover — the dealer-facing surface (B1–B6)

**For:** Virusan Thavanathan
**From:** Vishula
**Updated:** 10 September 2026

The ingestion service's ETL is finished and deployed to Step Functions. What is
left is everything a dealer actually touches: the upload endpoint, image
processing, notifications, the frontend, and the e2e tests.

**Nothing here is blocked on me.** The two things you would otherwise have had
to ask for — the image write adapter and the CSV header — are built and
documented below.

> **Deployment (S8 / Terraform) is mine.** Do not add AWS infrastructure; if you
> need something provisioned, ask and I will do it.

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
npm run test:ci            # 34 suites / 531 tests must pass
npm run test:integration   # 25 tests, needs the database above
npm run build
```

Then watch the pipeline run:

```bash
node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv
```

40 rows in, 34 loaded, 6 rejected, job `PARTIAL`. **That tool does exactly what
B1 must do** — store the file, insert the job, trigger the pipeline — so read it
before writing your controller. It is the reference implementation.

> **Everything runs from `dist/`, not tsx.** `emitDecoratorMetadata` is on and
> tsx uses esbuild, which does not emit it: every constructor's parameter types
> vanish and Nest cannot resolve anything. `npm run build` first, always.
>
> Related: **`npm run build` is the real typecheck.** `tsc --noEmit` uses
> different settings and has already let one error through that `nest build`
> caught.

---

## What already exists

| | Where |
|---|---|
| The whole ETL pipeline — 8 stages, orchestrator, queue handler | `src/workers/etl-worker/` |
| **Both cross-schema write adapters** (vehicles + images) | `src/workers/etl-worker/pipeline/persistence/` |
| Ports: `ObjectStore`, `JobQueue` + local **and AWS** drivers | `src/infrastructure/{ports,storage,queue}/` |
| 12 Lambda handlers, one per stage | `src/lambda/` |
| The Step Functions state machine | `src/infrastructure/step-functions/` |
| Repositories: jobs, rejections, stage logs, dealer profile, dictionary | `src/modules/ingestion/repositories/` |
| JWT auth: guard, strategy, `@CurrentUser`, `@Roles`, `RolesGuard` | `src/modules/auth/` |
| Job-status endpoint `GET /jobs/:id` | `src/modules/job-status/` |

Read these in order:

1. **`docs/ETL-PIPELINE.md`** — what each stage does and why
2. **`HANDOVER.md`** — the original B1/B2 brief, still accurate
3. **`docs/PHASE-A-REPORT.md`** — background, if you want the reasoning

---

## What is left

| | Status |
|---|---|
| **B1** `POST /ingest/upload` | nothing exists — `controllers`, `dto`, `services` are empty |
| **B2** job-status extension | endpoint exists; needs stage progress and paginated rejections |
| **B3** image processing | not started — **the write adapter is built**, inject it |
| **B4** notify | `AGGREGATE` is done; `NOTIFY` is not |
| **B5** dealer frontend | not started |
| **B6** e2e tests | `test/e2e/` is empty |

B1 and B5 are the biggest. B1 and B2 are independent of B3–B5, so start
wherever you like.

---

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
upload ends `COMPLETED` or `PARTIAL`:

| Status | Means |
|---|---|
| `COMPLETED` | every row loaded |
| `PARTIAL` | **a success** — some rows rejected with reasons, the rest loaded |
| `FAILED` | nothing loaded: a malformed file, or every row invalid |

`PARTIAL` is the normal outcome for a real dealer file. It is not your bug.

Also fill in the empty `/ingest/upload` schema in
`api-gateway/openapi/public-api.yaml` (multipart body, 202/400/401/403/413).

### Interfaces you need

```ts
// @Inject(OBJECT_STORE)
put(key, body, contentType?): Promise<string>
get(key): Promise<Buffer>
getStream(key): Promise<NodeJS.ReadableStream>
exists(key): Promise<boolean>
list(prefix): Promise<string[]>

// @Inject(JOB_QUEUE)
publish({ jobId }): Promise<void>     // resolves on accept, NOT on completion

// UploadJobRepository
create({ dealerId, fileName, csvS3Path, zipS3Path? })   // always starts PENDING
findByDealer(dealerId, limit?, offset?)

// DealerProfileRepository
isVerifiedBusinessDealer(userId): Promise<boolean>
```

**Storage key conventions** — the pipeline reads these:

| Key | Contents |
|---|---|
| `raw/{jobId}/{fileName}` | the dealer's CSV, immutable |
| `raw/{jobId}/{fileName}.zip` | the optional image ZIP |
| `staging/{jobId}/...` | inter-stage payloads (mine) |
| `images/{jobId}/{reg}/...` | processed images (yours, B3) |

The store **rejects any key escaping its root**, so pass a sanitized filename,
not the raw upload name.

---

## B2 — extend `GET /jobs/:id`

The endpoint exists. Add per-stage progress from `ingestion.etl_stage_logs` and
a paginated `rejected_records` slice (`rowNumber`, `reason`, raw row).

`RejectedRecordRepository.findForJob` and `EtlStageLogRepository.findForJob`
already return what you need.

Keep the existing posture: **a dealer reading another dealer's job gets 404, not
403** — a 403 confirms the job exists.

Stage logs now carry a `stage` on every rejection, so you can show which stage
rejected a row. `VALIDATE_FILE` with `rowNumber: 0` means the whole file was
rejected.

---

## B3 — image processing

**The adapter is already built:** `MarketplaceVehicleImagesWriteAdapter`,
exported from `IngestionModule`. Inject it; do not write
`marketplace.vehicle_images` yourself.

```ts
insertForVehicle(vehicleId, images, primaryIndex = 0): Promise<InsertedImage[]>
vehicleIdsByRegistration(jobId): Promise<Map<string, string>>
countForJob(jobId): Promise<number>
```

Three things that will bite you:

**One primary image per vehicle, enforced by the database.**
`idx_vehicle_images_one_primary` is a partial unique index on
`(vehicle_id) WHERE is_primary`; a second `is_primary = true` raises `23505` and
takes the whole statement with it. The adapter handles this — `primaryIndex`
names the primary and forces every other row false — but do not work around it.

**Match by canonical registration number.** `vehicleIdsByRegistration` returns
keys in the form `coerceRegistrationNumber` produces (`CAB-1234`), so fold a
filename through that function before looking it up or `cab1234.jpg` will miss.
It is in `pipeline/normalize/coerce.ts`.

**Zip-slip.** Every ZIP entry name is attacker-controlled. `LocalObjectStore`
rejects keys that escape its root, but check the entry name before you build a
key from it.

Unmatched images are reported, never fatal.

---

## B4 — notify

`AGGREGATE` is done (`src/lambda/aggregate-results.ts`). What is missing is
`NOTIFY`: an internal HTTP call using `NOTIFICATION_INTERNAL_URL` and
`INTERNAL_SERVICE_KEY`, plus an upload-summary template in
notification-service.

Failure here must **degrade, never fail the job** — the data is already loaded,
and a dealer who got their vehicles should not see `FAILED` because an email did
not send.

---

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

The parser accepts ~35 header aliases (`Manufacturer`→`make`, `YOM`→`year`,
`Odometer`→`mileage`), so a dealer's own export usually works unedited. Say so
in the UI; it saves support tickets.

It also accepts equipment columns — `full_option`, `alloy_wheels`,
`reverse_camera`, `leather_seats`, `power_steering`, `air_conditioning`, plus
`sunroof`, `seats`, `doors`, `drive_type`. Anything else a dealer includes is
appended to the listing description rather than dropped.

---

## B6 — tests

- `test/e2e/ingest-upload.e2e-spec.ts` — 401 unauthenticated, 403 non-dealer,
  403 individual dealer, 403 unverified dealer, 413 oversize, 202 happy path
- `test/e2e/job-status.e2e-spec.ts` — ownership 404, response shape
- `test/unit/pipeline/image-processing/` — registration matching, the
  single-primary invariant, zip-slip

Follow marketplace-service's `test/e2e/` pattern: real `Test.createTestingModule`
plus supertest, replicating `main.ts` wiring including the global
`ValidationPipe`.

---

## Conventions

**Tests** live in `test/unit/<area>/<name>.spec.ts` mirroring `src/`. Unit tests
use plain constructor injection with `jest.fn()` literals cast `as never` — **no
`Test.createTestingModule`**. See
`test/unit/ingestion/repositories/upload-job.repository.spec.ts`.

Three suites, separate on purpose:

```bash
npm run test:ci            # 34 suites / 531 tests, no database
npm run test:integration   # 25 tests, needs Postgres; skips itself without one
npm run test:e2e           # yours to fill
```

**Do not edit `src/shared/normalize-embed/`.** It is a byte-identical copy of
marketplace-service's, enforced by
`test/unit/shared/normalize-embed-parity.spec.ts`. Changing it invalidates every
stored embedding and requires editing both copies plus a re-seed. The README
beside it explains the procedure.

**Do not touch `src/lambda/`, `src/infrastructure/step-functions/`, or
`docker/`.** That is the deployment surface and it is mine.

**Routes** are `/ingest/upload` and `/jobs/:id` — nginx proxies both *without*
stripping the prefix, so the controller path includes it.

**Env** — every `INGESTION_*` variable is documented in `.env.example`.

---

## Definition of done

- [ ] `POST /ingest/upload` returns `202 { jobId }` for a verified business dealer
- [ ] 401 unauthenticated · 403 non-dealer, individual dealer, unverified dealer
- [ ] 413 over `INGESTION_MAX_UPLOAD_MB`; 400 on wrong file type
- [ ] Raw file readable at `raw/{jobId}/{fileName}` through `ObjectStore`
- [ ] `GET /jobs/:id` returns stage progress and paginated rejected rows
- [ ] A dealer cannot read another dealer's job (**404, not 403**)
- [ ] Images match vehicles by registration number; exactly one primary each
- [ ] Notification sent on completion; a failure there does not fail the job
- [ ] Frontend uploads, polls, and shows rejected rows with reasons
- [ ] OpenAPI stubs filled in for both routes
- [ ] All three test suites green
- [ ] An upload of `test/fixtures/e2e-mixed.csv` through your endpoint ends
      `PARTIAL` with rows in `marketplace.vehicles` — proving the whole path
      works, not just the 202

---

## The one thing I would ask

`pipeline/persistence/` holds both cross-schema write adapters, and ADR-002's
exception is only defensible while every write to `marketplace.*` goes through
them. Adding a repository elsewhere does not break a test — it dissolves the
architectural claim silently, and an integration test asserts the role holds no
DELETE precisely so the boundary is checked rather than assumed.

If you need a write that is not there, ask and I will add a method to the
adapter.

Everything else in your half, change freely.
