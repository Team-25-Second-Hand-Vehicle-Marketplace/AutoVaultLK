# Database Implementation — A to Z Log

> What was actually built, in the order it was built, and what remains.
> Companion docs: [plan-b-reads-cross-schemas.md](./plan-b-reads-cross-schemas.md)
> (the model this implements), [database-open-questions.md](./database-open-questions.md)
> (questions this work answered), [etl-search-contradictions-resolved.md](./etl-search-contradictions-resolved.md)
> (ERD deviations this reflects).

---

## Status: infrastructure complete and verified. Application logic not started.

The database itself — schemas, roles, tables, grants, and every service's
connection to it — is built, migrated, and boot-tested against a live
Postgres instance. **No business logic exists yet.** Reference tables are
empty, no repositories or controllers were written, and the shared spec-key
vocabulary discussed throughout the design docs is not yet code. See §9,
"What is NOT done," before assuming any feature work can start immediately.

---

## 1. The decision this implements

Two isolation models were drafted and compared —
[Plan A (strict isolation)](./plan-a-strict-isolation.md) and
[Plan B (reads cross schemas)](./plan-b-reads-cross-schemas.md). **Plan B was
chosen.** Its rule, in one sentence: a service may `SELECT` across a schema
boundary only where a foreign key already justifies the relationship;
`INSERT`/`UPDATE`/`DELETE` never cross schemas, with exactly one documented
exception.

That exception: ingestion-service's ETL loader writes directly to
`marketplace.vehicles` and `marketplace.vehicle_images`, because converting
that write to an HTTP call would invalidate the ETL design's connection-pool
concurrency argument (`MaxConcurrency: 10`) without providing a replacement.
The exception is scoped to `SELECT`/`INSERT`/`UPDATE` — never `DELETE`.

Reference data (`makes`, `models`, `aliases` — the pg_trgm-backed dictionary
tables for typo correction) went through the same two-option process
documented in plan-b §9. **Option B was chosen**: owned solely by
marketplace-service, ingestion-service holds read-only access and caches a
snapshot rather than querying per row. This keeps the platform to exactly
one cross-schema write exception instead of two.

## 2. ERD deviations decided before implementation

Three changes from the original `ERD.png` were agreed and then built —
**the ERD image itself was never updated to match** (see §9):

- **`body_type` removed** from `vehicles` as a column, moved into `specs`
  jsonb. It's a lookup-chain-derived value with a real vocabulary, judged
  worth keeping as a *concept*, but not worth a dedicated column once
  enrichment derivations were cut.
- **`seats` was never a column** — it only ever existed inside the
  `specs`/`KNOWN_SPEC_KEYS` model, corrected from an earlier draft that
  mistakenly put it under `filters`.
- **Enrichment derivations removed entirely**: no `age`, `slug`,
  `price_band`, `mileage_band` columns, and no equivalent computed values
  folded into `search_text` either. This was a deliberate scope cut, not an
  oversight — see [etl-search-contradictions-resolved.md](./etl-search-contradictions-resolved.md)
  item 1 for the tradeoff this accepts (buyers searching "cheap" lose the
  band-word signal in the embedding).

## 3. Docker and Postgres setup

`docker-compose.yml` runs `pgvector/pgvector:pg17` — chosen specifically
because the search design requires the `vector` extension for 384-dim
embeddings, and this image ships it precompiled.

**Port conflict discovered and fixed.** The development machine had a native
PostgreSQL 18 Windows service (`postgresql-x64-18`, startup type Automatic)
already bound to `0.0.0.0:5432`, silently winning the race against Docker's
port mapping. Every migration attempt authenticated against the wrong
server. Resolved by moving Docker's host mapping to `5433:5432` rather than
stopping the native service — both coexist permanently. All six connection
strings in `.env` updated to `localhost:5433`.

Three init scripts live in `database/docker/init/`, run automatically by the
Postgres image **only when the data volume is empty** (first `docker compose
up`, or after `docker compose down -v`):

| File | Does |
|---|---|
| `01-extensions.sql` | `CREATE EXTENSION vector`, `pg_trgm` |
| `02-schemas.sql` | Creates all five schemas |
| `03-roles.sql` | Creates all five service roles + `CONNECT` grants (no table grants — those need tables to exist first) |

## 4. Migrations — 15 files, in dependency order

All in `database/src/migrations/`, TypeORM-driven, run via
`npm run migration:run`. Ordered so every foreign key resolves against an
already-created table:

| # | File | Creates |
|---|---|---|
| 1 | `SchemasAndExtensions` | Idempotent safety net — repeats what init scripts do, for anyone migrating against an existing DB |
| 2 | `AuthUsers` | `auth.users` |
| 3 | `AuthDealerProfiles` | `auth.dealer_profiles` → users |
| 4 | `AuthRefreshTokens` | `auth.refresh_tokens` → users |
| 5 | `IngestionUploadJobs` | `ingestion.upload_jobs` → users |
| 6 | `MarketplaceVehicles` | `marketplace.vehicles` → users, upload_jobs. **No `body_type`, no `seats`, no derivation columns.** Has `specs jsonb`, `embedding vector(384)`, `search_vector tsvector` |
| 7 | `MarketplaceVehicleImages` | `marketplace.vehicle_images` → vehicles |
| 7.5 | `MarketplaceReferenceData` | `marketplace.makes`, `marketplace.models` (→ makes), `marketplace.aliases` (polymorphic, no FK) — Option B |
| 8 | `IngestionRejectedRecords` | `ingestion.rejected_records` → upload_jobs |
| 9 | `IngestionEtlStageLogs` | `ingestion.etl_stage_logs` → upload_jobs |
| 10 | `MarketplaceFavourites` | `marketplace.favourites` → users, vehicles |
| 11 | `MarketplaceSearchQueries` | `marketplace.search_queries` → users (nullable) |
| 12 | `NotificationNotifications` | `notification.notifications` → users |
| 13 | `AdminAuditLogs` | `admin.audit_logs` → users (SET NULL) |
| 14 | `SearchIndexes` | HNSW on `embedding`, GIN on `search_vector`/`search_text` (trgm)/`specs`, composite `(status, make, model)` / `(status, price)` / `(status, manufacture_year)`, plus a trigger keeping `search_vector` in sync with `search_text` automatically |

Design choices carried into every table:

- **`varchar` + `CHECK` instead of native Postgres enums**, everywhere. Chosen
  because enums are hard to alter (`ALTER TYPE ... ADD VALUE`, effectively
  impossible to remove values from) and the body-type/vehicle-type
  vocabularies are expected to grow.
- **`registration_number` uses a partial unique index**
  (`WHERE registration_number IS NOT NULL`) — blank values are legitimate
  (unregistered imports) and must not collide with each other; duplicates
  among *actual* values are rejected.
- **`aliases.entity_id` has no foreign key** — it's polymorphic, pointing at
  either `makes.id` or `models.id` depending on `entity_type`. Postgres
  can't express a conditional FK across two tables; integrity here is an
  application-level concern, traded for a single alias table instead of two.

## 5. Grants — `database/src/grants.sql`

Run after migrations (`GRANT ... ON ALL TABLES` needs tables to exist).
Encodes Plan B exactly:

- Each role gets full CRUD on its own schema, plus `ALTER DEFAULT
  PRIVILEGES` so future tables in that schema inherit the grant
  automatically.
- Cross-schema `SELECT` grants, each with a one-line comment naming the FK
  that justifies it (e.g. `marketplace.vehicles.dealer_id → auth.users.id`).
- The one write exception, called out with a multi-line comment explaining
  *why* (the connection-pool argument from §1), scoped explicitly to two
  tables and two verbs.
- Reference-table reads for ingestion, explicitly separate from the write
  exception so `INSERT`/`UPDATE` never leaks onto `makes`/`models`/`aliases`.
- admin-service: `SELECT` across all four other schemas, explicitly
  documented as read-only — every admin mutation is expected to go through
  the owning service's API, never a direct write here.

## 6. Verification — eight isolation tests, all run against the live database

Not theoretical — each was executed with `psql` connecting as the actual
scoped role, not the superuser:

| # | Test | Expected | Result |
|---|---|---|---|
| 1 | `marketplace_service_role` reads `auth.users` | succeeds (FK-justified) | ✅ |
| 2 | `marketplace_service_role` deletes `auth.users` | `permission denied` | ✅ |
| 3 | `ingestion_service_role` inserts `marketplace.vehicles` | FK violation, **not** permission denied — proves the exception grant works and only the fake data was rejected | ✅ |
| 4 | `ingestion_service_role` deletes `marketplace.vehicles` | `permission denied` (exception excludes DELETE) | ✅ |
| 5 | `ingestion_service_role` reads `marketplace.makes` | succeeds (Option B) | ✅ |
| 6 | `ingestion_service_role` writes `marketplace.aliases` | `permission denied` (reads only, promotion via API) | ✅ |
| 7 | `admin_service_role` reads `auth.users` | succeeds | ✅ |
| 8 | `admin_service_role` writes `marketplace.vehicles` | `permission denied` | ✅ |

Test 3 is the one that actually proves the exception is scoped correctly —
a foreign-key error, not an authorization error, means the grant permitted
the write and only the invalid `dealer_id` was rejected.

Structural checks also passed: 5 schemas exist, `vector`/`pg_trgm`
extensions installed, all 15 migrations recorded in `typeorm_migrations`,
zero columns named `body_type`/`seats`/`age`/`slug`/`price_band`/
`mileage_band` exist on `vehicles` (confirming the ERD deviation actually
landed), `specs jsonb` and `embedding vector` present, HNSW/GIN indexes all
built, `search_vector` trigger live.

## 7. Service scaffolding

Only `auth-user-service` had a NestJS scaffold before this work — the other
four services were empty directory trees (`Dockerfile`, `docker/`, `src/`,
`test/`, no `package.json`, no runnable code). All four were bootstrapped to
match `auth-user-service`'s exact file shape: `package.json`, `tsconfig.json`,
`tsconfig.build.json`, `nest-cli.json`, `.prettierrc`, `.dockerignore`,
`eslint.config.mjs`, `src/main.ts`, `src/health/{health.controller,
health.module}.ts`.

Port assignments (local dev only — irrelevant once services run as Lambda):

| Service | Port |
|---|---|
| auth-user-service | 3000 |
| marketplace-service | 3002 |
| admin-service | 3004 |
| ingestion-service | 3003 |
| notification-service | 3005 |

One cleanup along the way: `admin-service/node_modules` existed on disk with
no `package.json` behind it — orphaned output from an earlier, unrelated
`npm install`. Deleted before scaffolding fresh.

## 8. Entity layer — 25 files across five services

Every service got `src/config/database.config.ts`
(`TypeOrmModuleOptions`, `schema: '<owned schema>'`, `synchronize: false`
always) and `TypeOrmModule.forRoot(databaseConfig())` wired into
`app.module.ts` alongside `ConfigModule.forRoot()` (loads the root `.env`).

| Service | Entity files | Breakdown |
|---|---|---|
| auth-user-service | 3 | `User`, `DealerProfile`, `RefreshToken` — all owned |
| marketplace-service | 8 | 7 owned (`Vehicle`, `VehicleImage`, `Favourite`, `SearchQuery`, `Make`, `ModelEntity`, `Alias`) + `AuthUserView` (read-only, `auth.users`) |
| ingestion-service | 9 | 3 owned (`UploadJob`, `RejectedRecord`, `EtlStageLog`) + `AuthUserView` + `MakeView`/`ModelView`/`AliasView` (read-only Option B) + `VehicleWriteEntity`/`VehicleImageWriteEntity` (the one write exception, named with a `.write-entity.ts` suffix so its exceptional status is visible in the file tree) |
| notification-service | 2 | `Notification` (owned) + `AuthUserView` |
| admin-service | 6 | `AuditLog` (owned) + `AuthUserView`, `DealerProfileView`, `VehicleView`, `UploadJobView`, `NotificationView` — read-only across all four other schemas |

Every cross-schema entity is declared `synchronize: false` and never appears
in the schema-owning service's migrations — it exists purely so TypeORM has
a local class to query through.

## 9. Boot verification — all five services, against the live database

Not just "the code compiles" — each service was actually run:
`npm install` → `npm run build` → `node dist/main.js` → `curl
http://localhost:<port>/health`, confirming `TypeOrmModule` initialized
successfully, meaning every entity's schema/table/column mapping was
validated against the real Postgres instance, not just type-checked.

| Service | Result |
|---|---|
| auth-user-service | ✅ `{"status":"ok","service":"auth-user-service"}` |
| marketplace-service | ✅ — including the cross-schema `AuthUserView` |
| ingestion-service | ✅ — including both write-exception entities and three read-only reference views |
| notification-service | ✅ |
| admin-service | ✅ — the hardest case: six entities across **four different schemas** initialized simultaneously |

## 10. Git history

Nine commits, each independently reviewable:

```
9940f83  feat(database): schema-per-service database with 15 migrations
bae3f3e  fix(docker): move postgres to host port 5433
19cff5e  docs: finalize plan-b reference data ownership (Option B)
f5a4857  feat(auth-user-service): wire TypeORM to auth schema
1df12d0  feat(marketplace-service): bootstrap NestJS app, wire database
630c43a  feat(ingestion-service): bootstrap NestJS app, wire database
8ba8a15  feat(notification-service): bootstrap NestJS app, wire database
04a3dd3  feat(admin-service): bootstrap NestJS app, wire database
015fc34  chore: add package-lock.json for ingestion, notification, admin services
```

---

## What is NOT done

This is the important part — the database *infrastructure* is finished, but
almost nothing that uses it exists yet.

- **Reference tables are empty.** Zero rows in `makes`, `models`, `aliases`.
  Nothing can fuzzy-match anything until these are seeded.
- **No repositories, services, or controllers anywhere.** Every service has
  entities and a health check — nothing else. No auth endpoints, no listing
  CRUD, no search implementation, no ETL pipeline code.
- **`KNOWN_SPEC_KEYS` doesn't exist as code.** The `specs` GIN index is
  ready to support it, but the shared vocabulary — one definition consumed
  by the parser, the Groq prompt builder, and the SQL builder — is still
  only discussed in the design docs, per the silent-drift risk in
  plan-b-reads-cross-schemas.md §9A.
- **`ERD.png` was never updated.** It still shows `body_type` as a
  `vehicles` column, `age`/`slug`/`price_band`/`mileage_band` as columns
  that don't exist. Anyone reading the diagram as schema truth will be
  misled until it's corrected.
- **No HTTP client layer.** The cross-schema view-entities work at the
  database level, but no repository method or service class has been
  written that actually queries through one yet.
- **Alias-promotion loop is unbuilt.** The mechanism (logged corrections →
  promoted into `aliases`) is designed but has no implementation — no
  endpoint on marketplace-service for ingestion to call.
