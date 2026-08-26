# database — File-by-File Architecture

This package owns the shared PostgreSQL schema for the whole platform. It is
not a runtime service — nothing imports it at request time — it only runs
as CLI commands: create the schema, run migrations, seed data, verify
permissions. Every other service (`auth-user-service`, `marketplace-service`,
`ingestion-service`, `notification-service`, `admin-service`) connects to the
database this package builds, each through its own scoped role.

Read `README.md` first for the commands. This document explains what each
file actually does and why the schema is shaped the way it is.

---

## 1. The mental model in one paragraph

One Postgres database, **one schema per service** (`auth`, `marketplace`,
`ingestion`, `notification`, `admin`), each schema owned by a dedicated
Postgres role that can fully read/write only its own tables. 

Cross-schema
access is not blanket-allowed — every cross-schema **read** is granted only
where a foreign key already links the two tables, and there is exactly
**one** cross-schema **write** exception in the entire system (documented
in `grants.sql`), for a performance reason that's explained inline. This is
"Plan B" — referenced throughout the code as `plan-b §<section>`. Migrations
build the tables; `grants.sql` wires the permissions; seeds populate demo
data; `verify-roles.js` proves the permission boundary actually holds.

---

## 2. Top-level files

### `package.json`
Defines the TypeORM CLI scripts every other doc/command refers to:
`migration:create/generate/run/revert/show`, `grants` (pipes `grants.sql`
into the dev Postgres container via `docker exec`), `db:setup` (run +
grants together), and four `seed:*` scripts. Dependencies: `typeorm` +
`pg` (the migration runner), `bcryptjs` (admin seed hashes a real password),
`@xenova/transformers` (runs the MiniLM embedding model in Node for the
embeddings seed), `dotenv`.

### `src/data-source.ts`
The TypeORM `DataSource` every `migration:*` script points at (`-d
src/data-source.ts`). Loads `../.env` (repo root), reads `DATABASE_URL`,
sets `entities: []` (this package defines schema via raw SQL in migrations,
not TypeORM entity classes — those live in each service), and
`synchronize: false` (migrations are the only way schema changes — no
auto-sync in any environment). `ssl` is opt-in via `DATABASE_SSL=true`,
because RDS forces SSL but local Docker Postgres serves no certificate — one
config that works against both.

**Important:** this connects with the **migration-runner role** — effectively
superuser, full DDL rights — never one of the scoped per-service roles
described below. That's deliberate and is called out again in
`vehicles.seed.ts`.

### `src/grants.sql` — the security model, in one file
Not a migration — a standalone SQL script run *after* migrations (`GRANT
... ON ALL TABLES` only affects tables that already exist). Four sections:

1. **Own-schema full CRUD.** Each of the five roles gets
   `SELECT/INSERT/UPDATE/DELETE` on its own schema, plus `ALTER DEFAULT
   PRIVILEGES` so *future* tables in that schema automatically grant to the
   same role without re-running this file.
2. **Cross-schema reads**, each with an inline comment citing the FK that
   justifies it: `marketplace.vehicles.dealer_id → auth.users.id`,
   `ingestion.upload_jobs.dealer_id → auth.users.id`,
   `notification.notifications.user_id → auth.users.id`,
   `marketplace.vehicles.upload_job_id → ingestion.upload_jobs.id`. No FK,
   no cross-schema read — the rule stated explicitly in the file.
3. **The one documented write exception**: `ingestion_service_role` gets
   `SELECT, INSERT, UPDATE` (never DELETE) on `marketplace.vehicles` and
   `marketplace.vehicle_images`. Why: the ETL "load" stage bulk-inserts
   ~100 rows/chunk under a concurrency cap of 10, because that's the only
   stage in the pipeline holding a live DB connection — routing it through
   marketplace-service's REST API instead would push that same connection
   pressure onto the pool serving live buyer search traffic. Scoped to
   exactly two tables and never DELETE, because removing a listing is
   marketplace's decision alone.
4. **`admin_service_role`**: read-only across `auth`, `marketplace`,
   `ingestion`, `notification` — no write grant anywhere. Justified because
   admin dashboards are inherently cross-cutting aggregates; every admin
   *mutation* (approve dealer, deactivate user) goes through the owning
   service's HTTP API instead.

A trailing comment warns explicitly: any write grant added below that final
line "violates Plan B" without the same weight of justification as the ETL
exception.

### `docker/init/*.sql` — first-boot only
Run automatically by the Postgres Docker image, but **only** against an
empty data directory — so they don't help an existing database, which is
why migration `1735000001000` re-does the same two things idempotently.

- **`01-extensions.sql`** — `CREATE EXTENSION vector` (pgvector, for
  384-dim embeddings) and `pg_trgm` (trigram similarity, used for
  make/model typo correction — small enums use hardcoded typo maps instead
  of a trigram index).
- **`02-schemas.sql`** — creates the five schemas.
- **`03-roles.sql`** — creates the five login roles with local-only
  dev passwords (`dev_auth`, `dev_marketplace`, etc. — production uses AWS
  Secrets Manager) and grants `CONNECT`. Explicitly does **not** grant table
  privileges — that needs the tables to exist first, hence `grants.sql`
  running after migrations, not here.

### `scripts/verify-roles.js`
A standalone Node script (not TypeScript, run directly) that proves the
Plan B boundary actually works, not just that it was written correctly. For
each of the five roles it opens a connection **using that role's own
credentials** (`AUTH_DATABASE_URL`, `MARKETPLACE_DATABASE_URL`, etc. — not
the migration-runner URL) and runs a table of checks:

- **Positive checks** — can this role read its own schema, and the specific
  cross-schema tables `grants.sql` says it should be able to?
- **Negative checks** (`expectError: true`) — does writing to a schema this
  role should *not* touch fail with Postgres error code `42501` (permission
  denied)? If the write silently succeeds, the check fails loudly instead.
- **Mutating checks** (`rollback: true`) — wrapped in `BEGIN`/`ROLLBACK` so
  the smoke test never leaves junk rows behind.

There are also two `SCHEMA_CHECKS` that assert specific migrations actually
ran (e.g. `dealer_profiles.verified_by` exists), run against the
migration-runner connection. Exit code is non-zero if anything failed, so
this is CI-friendly. This is the practical proof that `grants.sql`'s
comments aren't just documentation — `npm run verify` (== `db:setup` +
this) is the command that would catch a regression in the permission model.

---

## 3. Migrations — read in order, they tell the project's history

All 27 migrations live in `src/migrations/`, each a `MigrationInterface`
with `up()`/`down()`, timestamp-prefixed so TypeORM applies them in order.
Two pairs share a timestamp (`1735000007000`/`7500`, `1735000019000` ×2,
`1735000020000` ×2, `1735000021000` ×2, `1735000022000` ×2) — harmless,
since TypeORM also orders by filename within an identical timestamp, but
worth knowing if you're hunting for a specific migration by number alone.

### Foundation (1–7): the original five-schema, six-table design

| # | Migration | What it does |
|---|---|---|
| 1 | `SchemasAndExtensions` | Idempotent re-run of the docker/init SQL, for anyone migrating against a pre-existing DB. `down()` deliberately does nothing — dropping a schema would cascade away every table in it. |
| 2 | `AuthUsers` | `auth.users`: the one table every other schema's FKs eventually point back to. `role` is a `CHECK` (`BUYER`/`DEALER`/`ADMIN`), not an enum type — kept as varchar so a role addition never needs an `ALTER TYPE`. |
| 3 | `AuthDealerProfiles` | `auth.dealer_profiles`, one row per dealer. `user_id` is **both PK and FK** with `ON DELETE CASCADE` — a strict 1:1 with `auth.users`, deleting the user removes the profile. |
| 4 | `AuthRefreshTokens` | `auth.refresh_tokens` — `token_hash` (never the raw token), `expires_at`, `revoked_at`. This is the table the web-frontend's rotating-refresh-token dance ultimately reads/writes against. |
| 5 | `IngestionUploadJobs` | `ingestion.upload_jobs` — one row per dealer CSV upload, `status` CHECK across the ETL lifecycle (`PENDING/PROCESSING/COMPLETED/FAILED/PARTIAL`), record counts. |
| 6 | `MarketplaceVehicles` | **The centerpiece table.** See §4 below — it's substantial enough to deserve its own section. |
| 7 | `MarketplaceVehicleImages` | `marketplace.vehicle_images` — `s3_path`/`processed_path`/`thumbnail_path`, `is_primary` enforced to at most one per vehicle via a **partial unique index** (`WHERE is_primary`) rather than an application-level check. |
| 7500 | `MarketplaceReferenceData` | The **original** make/model design: three tables (`makes`, `models`, `aliases`). Superseded by migration 16 below — read this one mainly to understand *why* it was replaced. |

### §4 — `marketplace.vehicles`, the core table

Worth reading closely since almost everything else in the platform points
at or through it.

- **Enums via `CHECK`, not Postgres `ENUM` types**, everywhere except two
  places added later (`dealer_type`, dealer `verification_status` — see
  migration 15) — a deliberate inconsistency the codebase lives with rather
  than a design ideal; CHECK constraints are far cheaper to extend
  (`ALTER TABLE ... DROP CONSTRAINT` + re-add) than a Postgres enum type,
  which is exactly what migration 20 (`ExtendVehicleTypes`) exploits.
- **`specs jsonb`** holds every type-specific attribute — `body_type`,
  `seats`, `doors`, `sunroof`, `drive_type`, `load_capacity_kg`,
  `engine_class`, etc. A bike has no `body_type`; a lorry has no `seats`.
  Putting these in JSONB instead of columns means a new vehicle type or a
  new spec key never needs a migration — the comment in the migration spells
  this out directly.
- **`make_raw`/`model_raw`** — added here, **dropped two migrations later**
  (17). They held the dealer's original, uncorrected spelling for audit;
  decided not worth the two columns once nothing consumed them.
- **`search_text`** (plain text) and **`search_vector`** (generated
  `tsvector`, kept in sync by a trigger — see migration 14) are the keyword
  layer. **`embedding vector(384)`** is the semantic layer — 384 dims
  because that's what `all-MiniLM-L6-v2` produces; the migration's comment
  stresses that ingest and search must use the *exact same* embedding
  model or results are silently, undetectably wrong (no error — just bad
  rankings). This is why `embeddings.seed.ts` imports the *same* embedder
  module marketplace-service uses, instead of re-implementing it.
- **`registration_number`** has a **partial unique index**
  (`WHERE registration_number IS NOT NULL`) rather than a plain
  `UNIQUE` column — blank registration numbers are legitimate (unregistered
  imports) and must be allowed to repeat; only *non-null* duplicates are
  rejected.
- **`status`** drives the buyer-facing gate (`LIVE` only) — indexed as the
  leading column of several composite indexes in migration 14, because
  "does this query start with `WHERE status = 'LIVE'`" is true of nearly
  every buyer-facing query in the system.

### Feature-history migrations (8–13)

`IngestionRejectedRecords` (per-row rejection reasons for a failed CSV
line), `IngestionEtlStageLogs` (one row per ETL pipeline stage per upload —
`stage` CHECK lists all 11 pipeline stages by name, `metrics jsonb` "from
day one so the 0.6 [confidence] threshold can be tuned against real dealer
files"), `MarketplaceFavourites` (buyer↔vehicle saves — the table the
`favourites` module in marketplace-service was scaffolded for but never
implemented; see the web-frontend notes on `useSavedVehicles` being purely
client-side today), `MarketplaceSearchQueries` (logs every search — `q`
text, extracted filters, confidence, `unresolved_tokens` — explicitly to
feed "threshold tuning and the alias-promotion loop"), `NotificationNotifications`
(email/notification log with a `type` CHECK and delivery `status`).

### Correction & hardening migrations (13–25)

These read like a running engineering log — each solves one concrete
problem, and several explain a real bug found in production/dev:

- **14, `SearchIndexes`** — the big one for search performance. Adds an
  HNSW index for cosine similarity on `embedding` (`vector_cosine_ops`,
  matches `ORDER BY embedding <=> $1`), a GIN index on `search_vector`, a
  trigram GIN on `search_text` ("ONLY for the gated last-resort retrieval
  path... Never for re-matching resolved values" — a scoping rule worth
  remembering when reading the parser later), a GIN on `specs` (serves the
  `@>` containment operator only, not `->>'key'` lookups — that gap gets
  closed in migration 19), and three `status`-led composite indexes. Also
  creates a **trigger** (`trg_vehicles_search_vector`) that regenerates
  `search_vector` from `search_text` on every insert/update — "so no
  service can forget to update it."
- **15, `AuthDealerProfileDetails`** — extends `dealer_profiles` with the
  fields the dealer registration wizard actually collects (`dealer_type`,
  `business_registration_number`, `business_address`, `city`,
  `verification_documents`), and **migrates the old `is_verified` varchar
  CHECK column into a proper Postgres enum** `verification_status`. Data
  migration via `UPDATE ... CASE`, old column dropped after.
- **16, `VehicleDictionaries`** — replaces the three-table `makes`/`models`/
  `aliases` design from migration 7500 with **one self-referencing table**,
  `marketplace.vehicle_dictionaries`. `parent_id` points a MODEL row at its
  MAKE row (NULL for MAKE rows); `dictionary_type` is CHECK-scoped to
  `MAKE`/`MODEL`/`BODY_TYPE`/`COLOR` so the same table can serve future
  dictionary types with zero migrations; `aliases jsonb` replaces the old
  design's **polymorphic foreign key** (`aliases.entity_id` pointing at
  either `makes.id` or `models.id` — something Postgres literally cannot
  express as a real FK). The migration comment confirms this was safe
  because the old tables were still empty. This is the table the
  web-frontend's Make/Model dropdowns and the NL search parser both read.
- **17, `DropVehicleRawFields`** — removes `make_raw`/`model_raw`, as noted
  above.
- **18, `AuthDealerVerificationAudit`** — adds `verified_by` (FK to the
  admin who decided, `ON DELETE SET NULL`) and `verified_at` to
  `dealer_profiles`, for FR-02.2 accountability.
- **19 (×2, same timestamp, different files)**:
  - `SpecAndYearSearchIndexes` fills two real gaps: a `specs->>'seats'`
    **range** query can't use the containment GIN from migration 14 (that
    index only serves `@>`), and worse, an unindexed `specs->>'seats' >=
    '5'` compares as **text**, where `'10' < '4'` lexicographically — both
    slow and wrong. Adds an expression index casting to `int`. Also indexes
    `COALESCE(registration_year, manufacture_year)` — the "effective year"
    fallback (Decision 3, referenced across the codebase) that keeps a
    listing with no registration year reachable by a year filter; a plain
    index can't serve a `COALESCE` expression, so the expression itself
    must be indexed. Plus a plain `status, mileage` composite that had been
    missed earlier.
  - `VehicleJobRegistrationUpsertIndex` adds a **composite** unique index
    `(upload_job_id, registration_number)` — distinct from migration 6's
    global unique on `registration_number` alone. The global one enforces
    "no duplicate registration number across the whole marketplace"; this
    composite one is what lets ingestion-service's ETL load stage safely
    retry a failed chunk via `ON CONFLICT ... DO UPDATE` without violating
    the global constraint.
- **20 (×2)**:
  - `AuthRefreshTokenFamilies` adds refresh-token-rotation-family tracking:
    `family_id`, `replaced_by_id` (self-FK), `user_agent`, `ip_address`,
    `device_label`, `last_used_at`. This is what lets auth-user-service
    detect refresh-token **reuse** (a classic stolen-token signal — if a
    token from an already-rotated family is presented, every token in that
    family can be revoked).
  - `ExtendVehicleTypes` widens the `vehicle_type` CHECK from the original
    six (`CAR/BIKE/VAN/TRUCK/SUV/BUS`) to eleven, adding
    `THREE_WHEELER/LORRY/PICKUP/TRACTOR/HEAVY_MACHINERY`. Carries an
    explicit **⚠️ four-places-must-agree** warning: this CHECK,
    marketplace-service's `VehicleType` entity enum, ingestion-service's
    write-entity enum, and marketplace's
    `vehicle-attributes.constants.ts` all have to move together, because
    ingestion-service writes to `marketplace.vehicles` directly (the one
    cross-schema write exception) **without importing marketplace's
    entities**, so a mismatch fails only at the database, with no
    compile-time warning. Also documents what was deliberately *excluded*
    (`SCOOTER`, `QUADRICYCLE` — too fine-grained for a top-level filter,
    modeled as `specs.body_type` instead). `down()` reassigns any row using
    a new type to `TRUCK` before dropping the constraint, so a rollback
    can't fail on data that wouldn't satisfy the old, narrower CHECK.
- **21 (×2)**:
  - `AuthAbuseProtection` adds `failed_login_attempts`/`locked_until` to
    `auth.users` and a new `auth.security_events` table (login attempts,
    IP, user agent, success/failure) — the backing store for rate-limiting
    and lockout logic in auth-user-service.
  - `DictionaryVehicleTypes` adds `vehicle_types text[]` to
    `vehicle_dictionaries`, so the Make dropdown can be scoped by selected
    vehicle type. A MAKE row lists every type it builds (Toyota → cars,
    vans, SUVs, lorries); a MODEL row carries exactly one. Empty array
    means "applies to every type," keeping the column meaningful even for
    flat dictionary types like `BODY_TYPE` that have no type scoping at
    all. Indexed with GIN for the `@>` (array containment) queries the
    dropdown issues.
- **22 (×2)**:
  - `AuthEmailVerification` adds `email_verified_at` (backfilled to
    `created_at` for existing rows — grandfathering everyone who registered
    before this feature existed) and a new `email_verification_tokens`
    table.
  - `DictionaryNullParentUniqueness` **fixes a real production bug**, and
    documents it in detail: the original unique constraint on
    `vehicle_dictionaries` was `UNIQUE(dictionary_type, parent_id,
    canonical_value)`, but Postgres never treats two `NULL`s as equal in a
    unique constraint — so for MAKE and BODY_TYPE rows (which always have
    `parent_id = NULL`), the constraint silently never fired, and
    re-running the dictionary seed **duplicated every make and body type**
    (30→60, 10→20) with no error at all. MODEL rows were unaffected because
    their `parent_id` is always a real value. The fix is a **partial
    unique index** `WHERE parent_id IS NULL` — Postgres partial indexes do
    enforce uniqueness among the rows they cover regardless of NULL
    semantics, because the index key itself is just
    `(dictionary_type, canonical_value)`; `parent_id IS NULL` is only the
    filter selecting which rows are covered. The migration also runs a
    defensive `DELETE` first, keeping whichever duplicate has the most
    child rows (oldest as tiebreak), so it's safe to run against a database
    that already has the duplication symptom — which, per the comment,
    this one did.
- **23, `AuthPasswordReset`** — `password_reset_tokens` +
  `password_history` (the latter presumably to block password reuse).
- **24, `NotificationIdempotencyAndDealerRejected`** — adds a unique
  `idempotency_key` to `notification.notifications` (FR-53: "a retried
  event cannot send twice") and widens the `type` CHECK to add
  `DEALER_REJECTED`, which the SRS appendix listed but the original CHECK
  omitted.
- **25, `AuthDealerRejectionReason`** — adds `rejection_reason` (nullable —
  an admin may reject without a reason, and pre-existing rejections predate
  the column) to `dealer_profiles`. The comment explains *why* this needed
  a column and not just an email: without it, the dealer loses the reason
  once they delete the email, support can't answer "why was I rejected,"
  and the migration-18 accountability trail records *who* decided but not
  *on what grounds*. This is the column the web-frontend review flagged as
  never actually collected by `AdminUsersPage`'s reject button — the schema
  supports it; the UI doesn't yet use it.

---

## 4. Seeds — `src/seeds/`

All four are idempotent (`ON CONFLICT DO NOTHING`, or explicit `WHERE
embedding IS NULL` filtering) and connect with the migration-runner
`DATABASE_URL`, same as migrations — never a scoped service role.

### `admin-user.seed.ts`
Seeds the one and only way to get an ADMIN account into a fresh database.
FR-12 forbids public self-registration as ADMIN, so without this script
there's no route into any admin page at all. Notably strict about
credentials: `ADMIN_SEED_PASSWORD` has **no default** — the script throws
rather than seed a guessable password that would be identical (and public,
via git) across every checkout of the repo. It re-validates the same
password policy the registration form enforces (`assertPasswordMeetsPolicy`
— 8+ chars, upper, lower, digit), hashes with **real bcrypt at cost 12**
(unlike the vehicle seed's throwaway dealer accounts — this one must
actually authenticate), and refuses to silently promote an existing
non-admin account to admin if the email collides. Re-running it does **not**
rotate the password of an existing account — it prints a notice instead.

### `vehicle-dictionaries.seed.ts`
Seeds `marketplace.vehicle_dictionaries`: **30 makes**, each with a
`types` array and known misspelling `aliases` (`toyata`, `corrola`,
`suzeki`, etc. — these are exactly what lets the NL search parser resolve
"corrola" without a Groq call), and their models (each carrying one
`type`). Deliberately **Sri Lanka-weighted** — deep model lists for
high-volume Japanese/Indian makes, shallow for rare premium European ones —
rather than a generic 200-make global list that would pad every dropdown
with brands nobody lists. Also seeds a flat `BODY_TYPES` dictionary (10
entries, `SEDAN`/`HATCHBACK`/etc., with aliases like `jeep → SUV`). Because
`ON CONFLICT` targets the constraint that migration 16 defines, this seed
is what motivated finding the null-parent-uniqueness bug fixed in migration
22 — the constraint it relies on for idempotency was the one that didn't
actually work for MAKE rows until that fix landed.

### `vehicles.seed.ts`
Seeds 5 dealer accounts (3 `VERIFIED`, 1 `PENDING`, 1 `REJECTED` — chosen
specifically to make `verifiedDealersOnly` testable) and **68 vehicles**
across all 11 vehicle types, round-robined across the 5 dealers. The
distribution is deliberately shaped to exercise known edge cases: roughly a
quarter have `regYear: null` (tests the Decision-3 "must not vanish from a
year-filtered search" fallback), several have empty `specs: {}` (tests the
`@>` containment path against a missing key), and seven rows at the bottom
are intentionally **not** `LIVE` (`PENDING_REVIEW`, `SOLD`, `DRAFT`,
`ARCHIVED`, `REJECTED`) specifically to prove the `status = 'LIVE'` gate
excludes them from buyer-facing search. Each vehicle's `search_text` is
built by concatenating the same fields ETL's Enrich stage would use, so
seeded search behavior matches what production ingestion would produce.
This script also writes to `auth.users`/`auth.dealer_profiles` directly —
a schema it doesn't own — which is explicitly called out as acceptable
*only* because it runs as the migration-runner role, never something
application code should do.

**Note:** the web-frontend README states "~160 LIVE listings" from this
seed; the actual count in the current file is 68 vehicles total (61 LIVE +
7 non-LIVE) — worth a quick check if that number matters for a demo.

### `embeddings.seed.ts`
Backfills `marketplace.vehicles.embedding` from `search_text`, standing in
for the ETL pipeline's `EmbedHandler` (which doesn't exist yet, per the
comment). Imports the embedder from `marketplace-service`'s own
`shared/normalize-embed` module rather than re-implementing MiniLM
locally — explicitly to guarantee listing vectors and query vectors come
from *one* shared library, since two independently-configured embedding
models would put vectors in incompatible spaces and degrade search
silently rather than erroring. Only touches rows where `embedding IS NULL`
(pass `--all` to force full regeneration, needed after a model change), and
skips rows with blank `search_text` on purpose — embedding an empty string
produces a real vector that would spuriously match unrelated queries, so
those listings are left honestly unranked instead. Runs sequentially, not
in parallel, because the ONNX runtime here is single-threaded CPU-bound —
concurrent calls would just contend for one core.

---

## 5. How this connects to the rest of the system

- **Every table a service entity maps to originates here.**
  `marketplace-service`'s `Vehicle`, `VehicleDictionary`, `Favourite`,
  `SearchQuery` entities (see the marketplace-service architecture doc)
  are TypeORM read/write mirrors of tables this package's migrations
  define — this package is schema source of truth, not the entity files.
- **The four-places-must-agree warning in migration 20** is the single
  most important cross-repo coupling to know about: changing what vehicle
  types exist means editing this CHECK constraint *and* three TypeScript
  files in two other services, with no compiler to catch a mismatch.
- **`grants.sql` is what actually enforces service isolation** — not code
  review, not convention. A service role literally cannot run a query
  outside what this file grants, which is why `verify-roles.js` treats a
  successful "forbidden" write as a test failure worth catching in CI.
