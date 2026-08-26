# marketplace-service — File-by-File Architecture

NestJS service on port `3002`, owning the `marketplace` schema. It's the
public read surface of the platform (browse, search, listing detail) plus a
dealer-facing write surface for listings. `npx nest build` passes clean;
`npx tsc --noEmit` currently flags strict-mode inference issues inside
`nl-search.service.spec.ts` only — those don't affect the real build, which
uses `tsconfig.build.json` and excludes `*.spec.ts`.

**Read `src/modules/search/README.md` first if you're touching search.** It
is an excellent 540-line, request-flow-first walkthrough of the filter
search pipeline, including the actual SQL it produces. This document does
not repeat that — it covers everything the README doesn't (bootstrap,
entities, auth, dealers, listings, the NL/parser/Groq pipeline it only
gestures at, and the shared embedding module), and cross-references the
README where the two meet.

For the tables this service reads and writes, see
`database/ARCHITECTURE.md` — this service owns none of the DDL.

---

## 1. The mental model in one paragraph

Two independent search entry points share one relaxation/facet/pagination
engine: `GET /search/filters` (sidebar clicks → straight to a parameterized
`WHERE` clause, `FilterSearchService`) and `GET /search/nl` (free text →
a 5-stage deterministic parser → optional Groq repair → MiniLM/pg_trgm
ranking → the *same* `FilterSearchService.search()`). Everything downstream
of "I have a `FilterSearchDto`" is one code path — the NL side's whole job
is producing that DTO plus a rank hint. Listings and dealers are much
thinner: `listings` is the dealer-facing CRUD surface with per-row ownership
checks, and `dealers` is presently a read-only projection of data
auth-user-service actually owns.

---

## 2. Bootstrap & config

### `package.json`
NestJS 11, TypeORM 11, `passport-jwt` (local JWT verification — this
service does **not** call auth-user-service over HTTP to check a token; it
verifies the signature itself and cross-checks the user row via the
read-only `auth.users` view-entity). `@xenova/transformers` runs MiniLM
in-process for query embeddings. `class-validator`/`class-transformer`
power every DTO. Jest config is inlined here rather than a separate file.

### `src/main.ts`
Bootstraps Nest, enables CORS, and installs one global `ValidationPipe`
with `transform: true`, `whitelist: true`, `forbidNonWhitelisted: true`.
The comment here is worth internalizing: `transform: true` is what actually
turns query-string `"2015"` into the number `2015` before any service code
runs — without it, validation happens against the *string* representation
(which still passes numeric-looking checks) but the values stay strings all
the way down. That was a real bug (`appliedFilters` showing quoted values).
Listens on `MARKETPLACE_PORT ?? PORT ?? 3002`.

### `src/app.module.ts`
Wires `ConfigModule` (global, reads `../.env` then `.env`), `TypeOrmModule`
from `databaseConfig()`, and three feature modules: `DealerModule`,
`ListingModule`, `SearchModule`, plus `HealthModule`.

### `src/config/database.config.ts`
Connects as `marketplace_service_role` (`MARKETPLACE_DATABASE_URL`),
`schema: 'marketplace'`, `synchronize: false` always — the comment is blunt
about why: five services share one database, and a sync here would reshape
tables out from under the others. Entities glob three suffixes:
`*.entity.ts` (owned tables), `*.view-entity.ts` (read-only cross-schema
projections), `*.write-entity.ts` (none currently exist in this service —
that suffix is ingestion-service's, for the one write exception documented
in `database/src/grants.sql`). Pool capped at `max: 5` — sized for one
Lambda container, with RDS Proxy multiplexing across containers in
production.

### `src/health/`
`GET /health` → `{ status: 'ok', service: 'marketplace-service' }`. Trivial
and unauthenticated, for load balancer / container health checks.

---

## 3. `src/infrastructure/database/entities/` — the ORM layer

### Owned entities

**`vehicle.entity.ts`** — mirrors `marketplace.vehicles` from migration 6
(plus everything added since). Two details worth knowing if you touch this
file: `embedding` is typed `text`, not a vector type, because **TypeORM has
no native pgvector type** — the column is written as the string form
(`'[0.1,0.2,...]'`) and Postgres/pgvector cast it; any similarity query
*must* be raw SQL (`embedding <=> $1::vector`), never the query builder.
Both `embedding` and `searchVector` are `select: false`, so they never leak
into an ordinary `SELECT *` or ride along in a buyer-facing payload by
accident. `searchVector` also has `update: false, insert: false` — it's
trigger-maintained (migration 14's `trg_vehicles_search_vector`), and
application code writing to it would just be overwritten. `price` has an
explicit transformer because Postgres `numeric` round-trips through `pg` as
a string by default.

**`vehicle-image.entity.ts`**, **`favourite.entity.ts`**,
**`search-query.entity.ts`**, **`vehicle-dictionary.entity.ts`** — thin
mirrors of their migrations (see `database/ARCHITECTURE.md` §3 for the
schema reasoning). `vehicle-dictionary.entity.ts` is worth a second look:
it's self-referencing (`parent` / `children` via `parentId`), matching
migration 16's collapse of the old three-table make/model/alias design.

### Cross-schema view-entities — read-only windows into `auth`

**`auth-user.view-entity.ts`** and **`dealer-profile.view-entity.ts`**
both carry `synchronize: false` and a comment stating plainly: this service
does not own these tables, `database/` does, and they're declared here
*only* so TypeORM can join `vehicles.dealer_id` against them. Both are
backed by `SELECT`-only grants (`database/src/grants.sql`) — nothing in
this codebase could write to them even if it tried.

Two callouts:
- `AuthUserView.emailVerifiedAt` exists specifically because `jwt.strategy.ts`
  reads it — a valid signature is not sufficient to authenticate; a
  non-ADMIN with an unverified email is rejected even with a technically
  valid token.
- `DealerProfileView` carries an explicit **cross-service coupling
  warning**: renaming `verification_status` or its enum values in
  auth-user-service silently breaks the `verifiedDealersOnly` search
  filter, and nothing except `grep` would catch it. Verification-document
  columns are deliberately *not* projected here — search has no legitimate
  reason to read them.

---

## 4. `src/modules/auth/` — local JWT verification

This service authenticates requests **without calling auth-user-service at
request time**. It has its own copy of the JWT verification logic
(`jwt.config.ts`, `jwt.strategy.ts`), configured to use the *same*
`JWT_ACCESS_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` env vars auth-user-service
signs with — the comment in `jwt.config.ts` calls this "admin validates
locally (SAD 3.5.1)."

- **`strategies/jwt.strategy.ts`** — Passport JWT strategy. On a valid
  signature, looks the user up by `payload.sub` against the `AuthUserView`
  read-only projection, and rejects if the user is inactive, missing, or
  (non-admin) email-unverified. Returns the minimal `AuthenticatedUser`
  shape (`id`, `email`, `role`) that everything downstream uses.
- **`guards/jwt-auth.guard.ts`** — wraps Passport's `AuthGuard('jwt')`,
  translating `TokenExpiredError`/`JsonWebTokenError` into specific,
  readable 401 messages instead of Passport's generic one. Structurally
  identical to admin-service's guard of the same name (see the earlier
  conversation trace of `GET /admin/dashboard` for a side-by-side).
- **`guards/roles.guard.ts`** + **`decorators/roles.decorator.ts`** — the
  usual `@Roles('DEALER', 'ADMIN')` metadata-and-guard pair via
  `Reflector.getAllAndOverride`.
- **`decorators/current-user.decorator.ts`** — `@CurrentUser()` pulls the
  authenticated user off the request, for handlers like
  `ListingController.createListing`.
- **`jwt-auth.module.ts`** — bundles the strategy + both guards +
  `TypeOrmModule.forFeature([AuthUserView])`, exported for `ListingModule`
  to import.

---

## 5. `src/modules/dealers/` — thin, and honestly incomplete

**`dealer.controller.ts`** exposes `GET /dealers/:id/profile`,
`GET /dealers/:id`, and `PUT /dealers/:id/profile` — all unauthenticated at
the route level (no guard on this controller at all).

**`dealer.service.ts`**: `getProfile`/`getDealerById` are real reads through
`DealerRepository`. **`updateProfile` is a stub** — it unconditionally
throws `NotImplementedException('Dealer profile updates are owned by
auth-user-service')`. The `PUT` route exists and is documented in the
controller, but calling it always 501s. Worth knowing if you're wiring a
frontend dealer-profile-edit screen against this service: it isn't there.

**`update-dealer-profile.dto.ts`** compounds this: it validates fields —
`address`, `province`, `profileImage` — that don't exist on
`DealerProfileView` at all (that view has `companyName`, `contactNumber`,
`city`, `dealerType`, `verificationStatus` — no address/province/image).
Even if `updateProfile` were implemented against the current view-entity,
half this DTO's fields would have nowhere to go.

**`dealer.repository.ts`** — `findById` joins `AuthUserView` (must be
`role: 'DEALER'`, `isActive: true`) with `DealerProfileView` by user id, and
maps to a flat `DealerSummary`. Returns `null` (not a throw) on either side
missing, which is what lets `listing.service.ts`'s `withDealer` degrade a
listing's dealer to `null` instead of failing the whole request.

---

## 6. `src/modules/listings/` — the dealer-facing write surface

**`listing.controller.ts`** — reads (`GET /listings`, `GET /listings/:id`)
are public, matching FR-54 ("guests browse without registering"). Writes
(`POST /listings`, `PATCH /listings/:id`, `PATCH /listings/:id/deactivate`)
require `JwtAuthGuard` + `RolesGuard` with `@Roles('DEALER', 'ADMIN')`.

**`listing.service.ts`** — the interesting logic lives here:
- **Ownership is never taken from the request body.** `createListing`
  always sets `dealerId: actor.id` from the verified JWT, and
  `CreateListingDto.dealerId` is explicitly documented as "ignored on
  write... kept optional so existing clients that still send it are not
  rejected." `updateListing` goes further and **strips** any `dealerId` the
  caller sends before persisting, specifically so a PATCH can't be used to
  reassign a listing to a different dealer with no audit trail.
- **`assertOwnership`** — a dealer may only mutate their own listings;
  `ADMIN` bypasses the check (moderation tooling shouldn't be locked out).
  On failure it throws the **same message** a missing listing would
  ("You do not have access to this listing") — deliberately, so the error
  can't be used to probe which listing ids exist for another dealer.
- **`withDealer`** — attaches a dealer summary to every listing in a list
  response, and distinguishes (via logging, not response shape) a
  genuinely-missing dealer from a failed lookup: both render as
  `dealer: null` to the caller, but only the second logs at `error` level,
  so a database outage doesn't read identically to "this dealer account was
  deleted."

**`listing.repository.ts`** — straightforward TypeORM CRUD.
`findAllLive()` has **no pagination** — it's `find({ where: { status:
'LIVE' }, order: { createdAt: 'DESC' } })` with no `take`/`skip`, unlike
every search-module endpoint. Worth flagging if this route is ever exposed
to a large catalogue; today's ~68 seeded vehicles make it invisible.

**`create-listing.dto.ts`** — has its own enum re-declarations
(`VehicleTypeDto`, `FuelTypeDto`, etc.) rather than importing
`vehicle-attributes.constants.ts`. This is a real drift, not just
duplication: **`VehicleTypeDto` still lists only the original six types**
(`CAR/BIKE/VAN/TRUCK/SUV/BUS`) — none of the five added in database
migration 20 (`THREE_WHEELER/LORRY/PICKUP/TRACTOR/HEAVY_MACHINERY`) are
valid here, even though they're fully supported everywhere in `search`
(`vehicle-attributes.constants.ts` has all 11, and the DB CHECK constraint
allows all 11). A dealer manually creating a `THREE_WHEELER` listing
through `POST /listings` would be rejected by this DTO's validation before
it ever reached the database. This is exactly the "four places must agree"
risk called out in the database migration's comment — `create-listing.dto.ts`
is a fifth place that was missed.

**`update-listing.dto.ts`** — `PartialType(OmitType(CreateListingDto,
['status']))`, i.e. every create field becomes optional and `status` is
excluded (deactivation goes through the dedicated endpoint instead).

---

## 7. `src/modules/search/` — beyond what the README covers

The module's own README explains the filter-search request flow in detail
(controller → service → query builder → repository → relaxation ladder) —
read that for the `/search/filters` path. This section covers what it
doesn't: the constants that anchor the whole module, the response/DTO
shapes, the NL pipeline's parser/Groq/embedding internals, and the test
suite.

### `search.module.ts` / `controllers/search.controller.ts`
Five public routes, all unauthenticated: `GET /search/filters` (the main
path), `GET /search/nl` (free text), `GET /search/facets` (standalone facet
counts for first paint — deliberately bypasses `FilterSearchService.search`
entirely so it doesn't run the relaxation ladder or write an analytics row
for a request that isn't really a search), `GET /search/stats` (landing
page headline figures), `GET /search/vehicles/:id` (detail page — lives
here rather than on `ListingController` because that controller's
`ParseIntPipe` would reject every UUID with a 400, and because this route
must stay public/read-only, unlike the listings write surface), and
`GET /search/options` (dropdown data).

### `constants/known-spec-keys.constants.ts` — the specs whitelist
**Single source of truth** for everything that can live in
`vehicles.specs` jsonb. The file's own comment states the stakes plainly:
four independent places must import this, never re-declare it — the DTO,
the query builder, the (future) Groq prompt builder, and ETL's enrichment
stage. Eight keys today: `body_type` (enum), `seats`/`doors`/`airbags`/
`load_capacity_kg` (int, each with declared min/max), `drive_type` (enum),
`sunroof` (bool), `engine_class` (enum, stored as a string like `"150cc"`
rather than parsed to an integer — deliberately, since normalizing that is
an ingestion problem, not a search one). Every one of these keys came from
what the seed data actually populated, not from a design document's
illustrative list.

### `constants/vehicle-attributes.constants.ts` — the column-value whitelist
Mirrors the live `CHECK` constraints on `marketplace.vehicles` exactly, and
says so: a parity test is meant to read `information_schema` and assert
these arrays match the database, so a migration edit that isn't mirrored
here fails CI instead of silently rejecting a valid value at runtime. This
is the file that correctly has all 11 vehicle types (contrast with
`create-listing.dto.ts` in §6, which doesn't). Also defines `SORT_OPTIONS`,
`DEFAULT_PAGE_SIZE` (20), `MAX_PAGE_SIZE` (50), and `SEARCHABLE_STATUS =
'LIVE'` — the one status buyer-facing search is ever allowed to return.

### DTOs

**`filter-search.dto.ts`** — the biggest DTO in the service. Two custom
`Transform`s carry real design history:
- **`toArray()`** — accepts both `?fuelType=PETROL,DIESEL` and repeated
  `?fuelType=PETROL&fuelType=DIESEL`.
- **`parseSpecs()`** — parses `?specs=body_type:SUV,engine_class:150cc`
  into `SpecFilterDto[]`. The comment documents *why* this flat string
  format exists instead of the more natural `specs[0][key]=x&specs[0][value]=y`
  with `@ValidateNested`: that combination is a documented-fragile
  interaction with `whitelist: true` — the nested array's own properties
  got rejected as "should not exist" even though the outer `specs` field
  was declared and `qs` parsed the bracket syntax correctly. This is the
  exact same fragility the web-frontend's `search.api.ts` comment
  independently rediscovered and worked around on the client side — both
  ends of the wire agree on the flat-string format for the same underlying
  reason.

Notable fields: `minYear`/`maxYear` apply to
`COALESCE(registration_year, manufacture_year)`, never `registration_year`
alone (Decision 3 — see the query builder below); `hasRegistrationYear` is
the opt-in strictness escape hatch, off by default so its absence never
hides a listing.

**`filter-search-response.dto.ts`** — `VehicleSearchResultDto` is
"deliberately thin" (its own comment) — `embedding`/`searchVector` are
`select: false` at the entity level and wouldn't belong in a buyer payload
regardless. `dealerVerified` gets a pointed comment: it's a **real per-row
LEFT JOIN value now**, not (as an earlier version did) an echo of the
`verifiedDealersOnly` filter — which meant the "Verified" badge could
previously only ever appear on a search that had already filtered to
verified dealers, i.e. exactly where the badge carried zero information.
`RelaxationDto` mirrors the ladder in `filter-search.service.ts`.

**`nl-search.dto.ts`** — just `q` (trimmed, max 500 chars) plus the same
control params (`sort`/`page`/`limit`/`facets`) as filter search. Structured
filters are never accepted here — they're the parser's job.

**`nl-search-response.dto.ts`** — extends the filter response with a
`parse` block whose four booleans (`needsGroqFallback`, `usedGroqFallback`,
`usedSemanticRanking`, `usedTrigramFallback`) are individually documented —
worth reading if you're debugging why a particular NL query behaved a
certain way, since these four map directly onto the pipeline stages below.

**`search-options-response.dto.ts`** — `MarketplaceStatsDto` is explicit
about what it *doesn't* model: "Happy Buyers" and "Satisfaction Rate" from
the design reference have no backing table (no orders, no reviews) and are
omitted rather than invented — the same "omit rather than fake" discipline
the web-frontend review found throughout that codebase.

### Services

**`filter-search.service.ts`** — orchestrates one search: build query →
count → **relax if zero rows** → fetch page + facets concurrently → log
(fire-and-forget) → return. The **relaxation ladder** (`relax()`) is the
most carefully-reasoned piece of business logic in this service, and its
comments are worth reading in full if you touch it:
1. Steps apply **cumulatively**, each on top of the last, and the response
   message names **every** step actually applied — an earlier version
   named only the *last* step, so a search that had silently dropped specs
   *and* widened mileage *and* widened years told the buyer it had only
   "relaxed the year range."
2. A step that would be a no-op (widening a range the buyer never set) is
   **skipped**, not counted — otherwise `droppedFilters` lists filters that
   were never applied, and the ladder burns an extra COUNT query on an
   identical search. This also explains why an old "step 4" (spec seat
   filtering) could never fire: step 1 had already nulled `specs`, so
   filtering seats out of `undefined` was structurally a no-op.
3. **Price is never dropped** — only flagged via `priceCeilingExceeded`.
   A buyer's stated budget is treated as a hard constraint they explicitly
   set, unlike a spec preference or a keyword.
4. Order: specs (most speculative) → keyword `q` (a typo can't be rescued
   by widening a range) → `hasRegistrationYear` (recovers real vehicles
   hidden only by strictness, before touching the buyer's actual year
   range) → mileage (±15%) → year (±1 year).

**`search-options.service.ts`** — two independent 5-minute in-process
caches (`Map`, not Redis — "this service has no Redis, the payload is a
few KB per key across at most 12 keys"): one for `getOptions()` (dropdown
data, keyed by vehicle type for the type-scoped make list), one for
`getStats()` (landing page figures, one query per "shape of question" —
totals, categories, top makes — run concurrently via `Promise.all`).
Districts are read live from `vehicles.location_district` rather than a
static 25-district list, specifically so the filter can never offer a
district with zero listings.

**`nl-search.service.ts`** — the NL pipeline's orchestrator, and the
cleanest single place to see the whole SAD 4.1.4 flow:
```
parseQuery(dto.q, vocab)                              — deterministic parser
  → groqFallback.repair(...)                          — only if confidence < 0.6
    → queryEmbedding = embeddings.embedQuery(semanticText)   — if any text left
      → chooseSearchRank(...)                          — decides vector vs trigram vs none
        → filterSearch.search(toFilterSearchDto(...), log, rank)  — same engine as /filters
```
`toFilterSearchDto` is a small but important function: it takes the
parser's `ExtractedFilters` and the caller's control params
(`page`/`sort`/`limit`/`facets`) and produces exactly the `FilterSearchDto`
the filter-search engine expects — this is the seam where the two search
entry points converge into one code path.

**`query-embedding.service.ts`** — wraps the shared MiniLM embedder (§8)
with three independent kill switches, each falling back to "skip semantic
ranking" rather than failing the search (FR-24/NFR-12.1): empty/blank
input, `EMBEDDING_DISABLED=true` env var, or the ONNX runtime throwing
(caught and logged at `warn`, not propagated).

### `filters/` — pure, testable query-building functions

**`filter-query.builder.ts`** — `buildFilterQuery(dto) → { whereSql,
params, appliedFilterKeys }`, a pure function with no DB access (that's
what makes `filter-query.builder.spec.ts` able to test it without
Postgres). Three things worth knowing:
- **`v.status = $1` always leads** — every composite index in the database
  migrations is built status-first, and this is the code that guarantees
  every query actually starts there.
- **Decision 3's COALESCE**, spelled out again here with a measured number:
  filtering on bare `registration_year` instead of
  `COALESCE(registration_year, manufacture_year)` produced 42 rows instead
  of 65 on the seeded data — i.e. silently hides ~35% of real inventory
  with no error.
- **Spec filters group by key**: multiple values for the *same* key OR
  together (`body_type=SUV,SEDAN` means "either" — a vehicle can't be both
  body types, so ANDing them always produced zero rows); different keys
  AND together (`body_type=SUV AND drive_type=4WD` is a real, valid,
  narrowing combination). `buildSpecClause` also does the actual
  whitelist enforcement against `KNOWN_SPEC_KEYS`, throwing
  `BadRequestException` on an unknown key or an out-of-range/wrong-type
  value — the same discipline the design doc applies to LLM output, here
  applied to ordinary buyer input.

**`search-rank.ts`** — decides *how* to rank/gate a query beyond plain
column filters, per FR-23/FR-24's priority order: a real query embedding
wins outright; otherwise, if the parser resolved *some* filters and there's
leftover text, pg_trgm ranks (not gates) on that leftover; otherwise, if
*nothing* resolved at all, pg_trgm both ranks *and gates* (`trigramWhere:
true`) as a last-resort retrieval mechanism, because showing every LIVE
listing after a total parse miss would defeat the point of search entirely.
`appendTrigramWhere` is careful to only fire that gate for the last-resort
case — a ranking-only trigram call (filters already resolved) must never
narrow the WHERE clause, only order the results.

**`sort-clause.ts`** — builds `ORDER BY`. `relevance` isn't one fixed
expression — it resolves to vector distance (`embedding <=> $n::vector`) if
a query embedding is present, else `word_similarity(...)` if a trigram
query is present, else `ts_rank(...)` against the keyword `q`, else falls
through to `created_at DESC` (i.e. `relevance` with no keyword search
degrades to "newest first" — no blended, ungrounded relevance score is
invented).

### `repositories/`

**`vehicle-search.repository.ts`** — the actual SQL execution layer, and
the file most worth reading end to end if you're debugging a specific
result. Highlights beyond what the README covers:
- **`IMAGE_JOIN` is `LEFT`, never `INNER`** — `vehicle_images` is currently
  empty in every environment, and an inner join would silently zero out
  every search result. `idx_vehicle_images_one_primary` (migration 7's
  partial unique index) is what guarantees this join can't fan a vehicle
  into duplicate rows and inflate `COUNT(*)`.
- **`verifiedDealersOnly` is applied outside the pure query builder**, in
  `buildFromAndWhere` — because it changes the `FROM` clause (adds a real
  `INNER JOIN` on `dealer_profiles`), not just `WHERE`, and the builder is
  deliberately scoped to vehicles-table-only clauses to stay a pure,
  unit-testable function.
- **`facets()`** implements standard faceted-search semantics: each
  dimension's counts are computed against every filter *except its own* —
  otherwise clicking "PETROL" would collapse the fuel-type facet list down
  to just "PETROL (34)" the instant it's selected, destroying the
  "if I also picked DIESEL, how many more would I see?" affordance the
  counts exist to provide. Five dimensions run concurrently via
  `Promise.all`.
- **`findById`** gates on `status = 'LIVE'` exactly like search, and
  returns `null` rather than throwing — deliberately, so a direct link to a
  DRAFT/SOLD/ARCHIVED listing renders as an ordinary 404, never confirming
  the listing exists in some other state.

**`vehicle-dictionary.repository.ts`** — loads and caches (5-min TTL, same
pattern as `search-options.service.ts`) a flat `ParserVocabulary` snapshot
(`makes`/`models`/`bodyTypes`) from `vehicle_dictionaries`, self-joined once
to attach each MODEL's parent MAKE name. This is the DB boundary the
parser needs — `rowsToVocabulary` (exported separately, unit-tested on its
own) does the actual row→vocabulary shaping, including tolerantly parsing
`aliases` whether Postgres hands it back as a real array or a JSON string.

### `parser/` — the deterministic 5-stage parser (SAD 4.1.4 / FR-21)

This is the module the README's "UI filters go straight to WHERE" framing
deliberately does *not* cover — it's the NL side. `parseQuery(raw, vocab)`
in `deterministic-parser.ts` is a **pure function**: vocabulary is injected
so the entire parser test suite runs without Postgres.

**Pipeline, in order:**
1. **`tokenize.ts`** — lowercases, strips punctuation, splits on
   whitespace. Domain stopwords (`STOPWORDS`) are **masked, not deleted** —
   they stay in the token stream so digit-adjacency detection and phrases
   like "from 2018" or "up to" still see the real layout, but they're
   excluded from the confidence denominator. `markDigitAdjacent` flags
   every token neighboring a number, which Stage 4 (fuzzy matching) uses to
   reject nonsense like matching part of a price as a make name.
2. **`stagePhrases`** (Stage 1) — 2–3-word exact and closed-enum phrase
   matches ("Land Cruiser", "three wheeler").
3. **`numeric-specs.ts`** (Stage 2a) — claims `"7 seat"`, `"4 doors"`,
   `"6 airbags"` as spec filters **before** the generic numeric stage sees
   them. This ordering is load-bearing: without it, a bare `"7"` reaches
   `numeric.ts`, which has no notion of seat counts, falls below both the
   price floor and the year window, classifies as nothing, and the token
   silently leaks into semantic text instead of becoming a filter.
4. **`numeric.ts`** (Stage 2) — price/year/mileage extraction with operator
   words (`under`/`below`/`max` → ceiling; `over`/`above`/`min` → floor;
   `older`/`before` → max-year specifically), unit suffixes (`8.5m`,
   `95k`), and a `between X and Y` construct.
5. **`stageExact`** (Stage 3) — single-token exact make/model/closed-enum
   matches. **Make is always resolved before model** (SAD 6.7) — this
   ordering is what lets `modelAllowed()` constrain model candidates to
   only those belonging to an already-resolved make.
6. **`stageFuzzy`** (Stage 4) — pg_trgm-style trigram similarity (the
   in-process `trigram.ts` reimplementation, used so the parser stays
   Postgres-free for tests) against makes/models (threshold 0.45,
   `TRIGRAM_THRESHOLD`) and — separately, at a **tighter** 0.52
   (`BODY_TYPE_FUZZY_THRESHOLD`) — body types. The gap between these two
   thresholds is a documented, measured fix for a real false-positive:
   `"volkswagon"` scored 0.4706 against `"wagon"`, clearing the shared 0.45
   bar, and because Volkswagen isn't in the make dictionary, `body_type:
   WAGON` was the *only* candidate — the query silently resolved at
   confidence 1.0 to "all wagons" and returned 80 irrelevant listings,
   never even reaching Groq because nothing looked unresolved. Real
   body-type typos (`"sedn"`, `"hachback"`, `"convertable"`) measured
   ≥0.545, so 0.52 rejects the collision while keeping every genuine
   misspelling — raising the *global* threshold instead would have broken
   legitimate make/model matches sitting in the 0.45–0.52 band.
7. **`finalize`** — computes `confidence = consumedTokens / meaningfulTokens`
   (1.0 if there were no meaningful tokens at all), sets `needsGroqFallback
   = confidence < 0.6` (`CONFIDENCE_THRESHOLD`), and joins every unconsumed
   token into `semanticText` for the embedding stage.

**`vocabulary.ts`** is the shared matching engine both stages 1/3 (exact)
and 4 (fuzzy) call into — `compact()` normalizes "Land Cruiser" /
"land-cruiser" / "landcruiser" to one lookup key, `exactSpanHit`/`fuzzySpanHit`
try progressively shorter multi-word spans, and `exactClosedHit`/
`fuzzyClosedHit` handle the small fixed enums (vehicle type, condition,
fuel, transmission, drive type, body type) separately from the large
dictionary-backed ones (make, model).

### `groq/` — the LLM repair step, entered only below the confidence gate

**`groq-client.ts`** — a deliberately SDK-free HTTP client (Groq is
OpenAI-Chat-Completions-compatible, so raw `fetch` is enough), with a
1500ms timeout and exactly one retry on 429/5xx/timeout (`isRetryable`).
`GroqUnavailableError` is the single failure type every caller catches.

**`groq-prompt.ts`** — `GROQ_SYSTEM_PROMPT` is a tightly-scoped extraction
prompt: it enumerates the *exact* allowed filter keys, states the model's
actual job plainly ("fixing misspellings the deterministic parser could not
match" — phonetic/keyboard-slip variants like `"mistubisi"`, `"toyata"`,
`"nisan"`), and is explicit that inventing a value absent from the allowed
lists is forbidden while *correcting* a misspelling *to* an allowed value is
required. `buildGroqUserPayload` sends the query, the parser's partial
filters, the unresolved tokens, and the full allowed-values payload
(vehicle types, conditions, fuel/transmission types, every make/model in
the dictionary, every known spec key) — so the model is grounded in the
live vocabulary, not guessing from training data.

**`groq-whitelist.ts`** — the enforcement half of "never invent a value."
`whitelistGroqOutput` re-validates *everything* Groq returns against the
same whitelists the deterministic parser itself is scoped to (enum sets,
the dictionary index, `KNOWN_SPEC_KEYS` min/max/enum bounds) and **never
throws** — a malformed payload becomes an empty filter set, logged via
`dropped`. `mergeFilters` then enforces ADR-004's ordering: **rules-parsed
fields always win** over anything Groq returned for the same field — Groq
only fills gaps the deterministic parser left empty, never overrides a
match the parser was confident enough to make itself.

**`groq-fallback.service.ts`** — the glue: skip entirely if
`!needsGroqFallback` or no API key configured (logged, not an error); on
any failure (network, timeout, malformed JSON) catch and return the
original rules-only result — Groq is purely additive and can never make a
search worse than not calling it.

### Tests — what the suite actually proves

19 spec files. Grouped by what they establish, since reading them as a
group is often faster than reading the implementation alone:
- **DTO/validation** (`filter-search.dto.spec.ts`): array coercion, enum
  whitelisting, numeric bounds, specs string parsing, and — importantly —
  that unknown query params are rejected (`forbidNonWhitelisted` behavior).
- **Query building** (`filter-query.builder.spec.ts`): status gating, every
  column filter, the Decision-3 year COALESCE specifically, spec filters,
  the keyword layer.
- **Ranking** (`search-rank.spec.ts`, `sort-clause.spec.ts`): the
  vector-vs-trigram-vs-none decision tree and every `ORDER BY` branch.
- **Parser** (`deterministic-parser.spec.ts`, `numeric-specs.spec.ts`,
  `collision.spec.ts`): the SRS Appendix B "messy row" acceptance case,
  stage-3-vs-stage-4 boundary behavior, make-before-model ordering,
  multi-word phrases, numeric patterns, and — as its own dedicated file —
  the closed-enum fuzzy collision class the body-type threshold fix
  addressed.
- **Groq** (`groq-whitelist.spec.ts`, `groq-fallback.service.spec.ts`):
  whitelist enforcement and merge-precedence, and the fallback service's
  skip/retry/failure paths.
- **Repository** (`vehicle-search.repository.spec.ts`,
  `vehicle-dictionary.repository.spec.ts`): search/count/facets SQL shape,
  vector ranking, `verifiedDealersOnly` join behavior, and vocabulary
  row-shaping.
- **Service-level** (`filter-search.service.spec.ts`,
  `nl-search.service.spec.ts`, `query-embedding.service.spec.ts`): the
  relaxation ladder end to end, the NL orchestration seam
  (`toFilterSearchDto`), and the embedding service's three fallback paths.
- **Controller** (`search.controller.spec.ts`): route wiring for all five
  endpoints.
- **Shared** (`vector.spec.ts`): `l2Normalize`/`toPgVector`/`assertEmbedding`
  in isolation.

**Note:** `nl-search.service.spec.ts` currently fails a bare `npx tsc
--noEmit` pass with strict tuple/undefined errors around destructured mock
return values (e.g. `const [dto, log, rank] = mockFn.mock.calls[0]` where
TS can't prove the call happened). This doesn't affect `npm run build`
(which uses `tsconfig.build.json`, excluding spec files) or `npm test`
(which runs through `ts-jest`, not a standalone `tsc` pass) — but it's
worth a quick look if CI ever adds a standalone typecheck step over the
whole `src/` tree including tests.

---

## 8. `src/shared/normalize-embed/` — the one embedding implementation

Four small files, and the single most cross-cutting piece of infrastructure
in the repo: `database/src/seeds/embeddings.seed.ts` **imports this exact
module** rather than re-implementing MiniLM, specifically so seeded
vectors and query-time vectors are guaranteed to come from the same model,
version, pooling, and normalization (FR-22.1/NFR-26.1). The module's own
header comment states the rule directly: don't re-declare
`EMBEDDING_DIMENSIONS` or `EMBEDDING_MODEL_ID` anywhere else.

- **`constants.ts`** — `EMBEDDING_DIMENSIONS = 384`,
  `EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'`.
- **`vector.ts`** — `assertEmbedding` (dimension + finite-value check),
  `toPgVector` (the `'[0.1,0.2,...]'` string pgvector expects),
  `l2Normalize` (used defensively even though the pipeline call already
  requests `normalize: true` — belt and suspenders on a value that flows
  straight into a `::vector` cast).
- **`embedder.ts`** — `createXenovaEmbedder()` returns an `Embedder` whose
  `embed()` lazy-loads the ~90MB ONNX model on **first call only** — this
  is what keeps unit tests (which inject a fake `Embedder`) from ever
  downloading it. `toNumbers` guards against the feature-extraction
  pipeline's `Tensor` type theoretically returning `BigInt64Array` (an
  integer-output artifact of the general tensor type, not something this
  particular model call produces) — narrowing it up front avoids a
  confusing `Number.isFinite` failure downstream in `assertEmbedding`.
- **`index.ts`** — the module's public surface; everything above is
  otherwise private to the directory.

`query-embedding.service.ts` (§7) is this module's only consumer inside
marketplace-service; `database/src/seeds/embeddings.seed.ts` is its only
consumer outside it.

---

## 9. How this connects to the rest of the system

- **Every enum/CHECK constraint this service validates against originates
  in `database/`'s migrations** — `vehicle-attributes.constants.ts` and
  `known-spec-keys.constants.ts` are meant to be kept in lockstep with
  them by hand (a parity test is referenced but its existence wasn't
  confirmed in this pass).
- **The web-frontend's `search.api.ts`** independently arrived at the same
  flat `"key:value,key:value"` specs format this service's
  `parseSpecs()`/`FilterSearchDto` expects, for the identical
  `whitelist: true` + nested-array fragility reason — both ends of that
  wire agree without either importing the other.
- **`create-listing.dto.ts`'s stale 6-type enum** (§6) is the concrete,
  present-day instance of the "four places must agree" risk the database
  migration warns about — worth fixing if dealer-created listings for the
  five newer vehicle types are expected to work.
- **`dealers/dealer.service.ts`'s stub `updateProfile`** (§5) means any
  frontend "edit dealer profile" flow pointed at this service's `PUT
  /dealers/:id/profile` will always 501 — that functionality, if it
  exists, must live in auth-user-service instead.
