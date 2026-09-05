# ingestion-service — handover to Dev B

Phase 0 (foundations) is complete. This document is what you need to build
**B1 (`POST /ingest/upload`)** and **B2 (job-status extension)** without
reading the rest of the codebase first.

Full plan: `C:\Users\Admin\.claude\plans\analyse-the-full-codebase-composed-corbato.md`

---

## Start here

```bash
cd D:\Projects\AutoVaultLK
docker compose up -d postgres          # pgvector on host port 5433
npm --prefix database run migration:run
npm --prefix database run grants       # REQUIRED — see "Dealer gate" below
npm --prefix database run seed:dictionaries

cd ingestion-service
npm ci
npm run test:ci                        # 13 suites / 109 tests must pass
npm run build && node dist/main.js     # listens on 3003
```

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

**1. The pipeline does not exist yet.** A placeholder handler
(`src/modules/ingestion/queue-bootstrap.service.ts`) marks every job `FAILED`
right after upload and logs a warning at boot. That is expected. Your endpoint
returning `202` and the job then showing `FAILED` means **your code worked.**
The placeholder is deleted when the orchestrator lands (§A8).

**2. Dealer gate needs a grant that may not be applied in your database.**
`GRANT SELECT ON auth.dealer_profiles TO ingestion_service_role` was added to
`database/src/grants.sql`. If `DealerProfileRepository` throws a permission
error, run `npm --prefix database run grants`. Verify with:
```sql
SELECT has_table_privilege('ingestion_service_role','auth.dealer_profiles','SELECT');
```

**3. `pipeline/persistence/` is mine — do not add a second writer.**
ADR-002 confines the *entire* platform's cross-schema write exception to one
adapter class. For B3 (images) you need to write `marketplace.vehicle_images`;
**ask me for the method signature**, don't add a repository. Two writers breaks
the architectural claim the whole design rests on.

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

## Definition of done for B1/B2

- [ ] `POST /ingest/upload` returns `202 { jobId }` for a verified business dealer
- [ ] 401 unauthenticated · 403 non-dealer, individual dealer, unverified dealer
- [ ] 413 (or 400) over `INGESTION_MAX_UPLOAD_MB`; 400 on wrong file type
- [ ] Raw file readable at `raw/{jobId}/{fileName}` through `ObjectStore`
- [ ] `upload_jobs` row created `PENDING` with the right `dealer_id`
- [ ] `GET /jobs/:id` returns stage progress + paginated rejected rows
- [ ] A dealer cannot read another dealer's job (**404, not 403**)
- [ ] OpenAPI stubs for both routes filled in (`api-gateway/openapi/public-api.yaml`)
- [ ] `npm run test:ci` and `npm run test:e2e` green
