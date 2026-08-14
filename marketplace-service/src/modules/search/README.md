# Filter-Based Vehicle Search — What Was Built and How It Works

This document explains, file by file, how a buyer's filter selection turns into
search results. It covers the **UI-filter path only** — the natural-language
("type a sentence") search pipeline described in
`Documentation/intelligent-search.pdf` is separate, unbuilt work that this
module is deliberately shaped to plug into later without a rewrite.

Read this if you're touching search code for the first time, reviewing a PR
against it, or resolving a merge conflict with another branch that also
touches `marketplace-service`, `vehicle_dictionaries`, or the frontend search
page.

---

## 1. The mental model in one paragraph

A buyer sets filters in a sidebar (make, price range, fuel type, etc.) and
clicks **Apply Filters**. The frontend turns that into a query string and
calls `GET /search/filters`. The backend validates every parameter against a
whitelist, turns it into one parameterized SQL statement (never string
concatenation), runs it against `marketplace.vehicles`, and — if the query
matched zero rows — automatically loosens the least-important filters one at
a time until something comes back, telling the buyer what it relaxed. No
LLM, no parser, no vector search is involved anywhere in this path; that's
the entire point of the design ("UI filters go straight to WHERE").

---

## 2. Request flow, top to bottom

```
Browser (SearchPage.tsx)
   │  buyer clicks "Apply Filters"
   ▼
useVehicleSearch hook — draft filters → URL query params
   │
   ▼
search.api.ts — serializes filters to a query string
   │  GET /marketplace/search/filters?vehicleType=CAR&fuelType=HYBRID&...
   ▼
Vite dev proxy (or nginx in prod) — strips "/marketplace", forwards to :3002
   │
   ▼
SearchController.filterSearch()
   │  @Query() dto: FilterSearchDto  ← class-validator runs HERE, before
   │                                    the method body executes
   ▼
FilterSearchService.search(dto)
   │  1. buildFilterQuery(dto)        — pure function, DTO → SQL WHERE clause
   │  2. repository.count(...)        — how many rows match?
   │  3. if 0 → relax(...)            — loosen filters, re-count, repeat
   │  4. repository.search(...)       — fetch the actual page of rows
   │  5. repository.facets(...)       — per-filter counts, if requested
   │  6. fire-and-forget log to marketplace.search_queries
   ▼
VehicleSearchRepository — runs the real SQL against Postgres
   │
   ▼
Postgres — marketplace.vehicles, filtered and sorted using real indexes
   │
   ▼
FilterSearchResponseDto — shaped JSON back to the browser
   │
   ▼
SearchPage.tsx renders VehicleCard[] + facets + pagination
```

---

## 3. File-by-file — what each one does and why it exists

### `constants/vehicle-attributes.constants.ts`
The enum values for `vehicleType`, `fuelType`, `transmissionType`,
`condition`, sort options, and `SEARCHABLE_STATUS = 'LIVE'`. These mirror the
live `CHECK` constraints on `marketplace.vehicles` exactly. **Nothing else in
this codebase is allowed to hardcode these lists** — every DTO, every SQL
clause that needs one of these values imports from here. If a migration ever
adds a 12th vehicle type without updating this file, the (planned, not yet
written) parity test is what's supposed to catch it — see §7.

### `constants/known-spec-keys.constants.ts`
The single source of truth for what can live inside the `vehicles.specs`
JSONB column and be filtered on: `body_type`, `seats`, `doors`, `drive_type`,
`sunroof`, `airbags`, `engine_class`, `load_capacity_kg`. Each key declares
its own type (`enum` / `int` / `bool`) and, for `int`, a min/max range.

This exists because `specs` has no schema of its own — a car has a
`body_type`, a bike doesn't, a lorry has `load_capacity_kg`, nothing else
does. Without one shared list, the frontend, the query builder, and (later)
an LLM prompt would each need their own copy of "what's a valid spec," and
those copies would silently drift apart. This is the constant referenced as
"plan-b §risk-3" in code comments throughout the module.

### `dto/filter-search.dto.ts`
The whitelist boundary. Every query parameter a buyer can send is declared
here with a `class-validator` decorator — `@IsIn(VEHICLE_TYPES)`,
`@IsInt() @Min(0)`, etc. NestJS's global `ValidationPipe` (registered in
`main.ts`) runs these checks **before** the controller method body executes.
Anything not declared here is rejected outright (`forbidNonWhitelisted:
true`), and every declared field is type-coerced from its raw string query
value into a real number/boolean/array (`transform: true`) before any
service code touches it.

**The `specs` field is intentionally not a nested class-validated array.**
The original version used `@ValidateNested({ each: true }) @Type(() =>
SpecFilterDto)` with `specs[0][key]=x&specs[0][value]=y` query syntax — this
is a documented fragile interaction with `whitelist: true`: valid nested
properties got rejected as "should not exist" even though the query string
itself parsed correctly. `specs` is now a flat `?specs=body_type:SUV,seats:5`
string, parsed by a custom `@Transform`. This sidesteps the nested-object
whitelist interaction entirely, at the cost of a slightly less
self-documenting query string.

### `dto/filter-search-response.dto.ts`
The response shape: `items`, `total`, `page`, `limit`, `totalPages`,
`appliedFilters` (echoes back what was actually applied, post-relaxation),
`facets` (optional per-filter counts), and `relaxation` (present only when
the zero-result ladder fired — see §5).

### `dto/search-options-response.dto.ts`
The shape for `GET /search/options` — the payload that drives dropdown
population: every vehicle type, condition, fuel type, transmission type, and
body type, plus the make→model tree from the dictionary table.

### `filters/filter-query.builder.ts` — the core, and the only file that writes SQL fragments
A pure function: `buildFilterQuery(dto) → { whereSql, params, appliedFilterKeys }`.
Zero database access, so it's fully unit-testable in isolation (see §7 —
these tests don't exist yet, but this is exactly where they'd go).

What it does, filter by filter:
- **Always emits `v.status = 'LIVE'` first**, non-negotiably. Every index on
  this table is built with `status` leading (see `1735000014000-
  SearchIndexes.ts`, `1735000019000-SpecAndYearSearchIndexes.ts`), and no
  buyer-facing query is allowed to see non-`LIVE` listings.
- **Column filters** (`make`, `fuelType`, etc.) become `column = ANY($n::text[])`.
- **Year filters apply to `COALESCE(registration_year, manufacture_year)`,
  never `registration_year` alone.** `registration_year` is nullable because
  dealers sometimes omit it; filtering on it directly would silently hide
  those listings from every year-filtered search with no error. On the
  seeded test data, a naive filter returned 42 rows where the COALESCE
  version correctly returned 65 — a 35% loss of visible inventory from one
  missing NULL check. `hasRegistrationYear=true` is the opt-in escape hatch
  for a buyer who explicitly wants only confirmed years.
- **Spec filters** (`body_type`, `seats`, etc.) are validated against
  `KNOWN_SPEC_KEYS` and grouped by key before being turned into SQL:
  - Enum and boolean specs use `v.specs @> '{"key":"value"}'::jsonb`
    (containment), which is what lets Postgres use the existing
    `idx_vehicles_specs` GIN index. The arrow-operator form
    (`specs->>'key' = 'value'`) would force a full table scan — same
    query, ~100× different plan.
  - Int specs (`seats`, `airbags`, `load_capacity_kg`) use
    `(specs->>'key')::int = $n` — containment can't express these, and
    that's why `1735000019000-SpecAndYearSearchIndexes.ts` added dedicated
    expression indexes for `seats` specifically.
  - **Multiple values for the same key are OR'd; different keys are
    AND'd.** A buyer checking both "SUV" and "Sedan" body types wants
    either, not an impossible vehicle that's both at once — that bug
    existed (every multi-select spec filter silently returned zero rows
    and triggered the relaxation ladder) until it was found and fixed
    during manual testing against the Figma design.
- **Keyword search** (`q`) uses `plainto_tsquery('english', $n)` against the
  `search_vector` tsvector column — a keyword-exact layer, not a substitute
  for the (unbuilt) semantic/embedding search.

Every value that reaches SQL is parameterized (`$1`, `$2`, …) — nothing is
ever string-concatenated, including free-text fields like `make` or
`locationCity`.

### `repositories/vehicle-search.repository.ts`
Takes the `{whereSql, params}` from the builder, adds `ORDER BY` (mapped from
the `sort` DTO field), `LIMIT`/`OFFSET`, and runs the actual query via
TypeORM's `DataSource.query()`. Three methods:
- `search()` — the paginated rows for display.
- `count()` — total matching rows, used both for pagination metadata and to
  detect a zero-result search that needs relaxing.
- `facets()` — one `GROUP BY` query per filter dimension (vehicle type, make,
  fuel type, transmission, condition), producing the "SUV (14)" style counts
  the sidebar shows.

`verifiedDealersOnly` is handled **here**, not in the query builder — it
requires `JOIN auth.dealer_profiles ON dp.user_id = v.dealer_id AND
dp.verification_status = 'VERIFIED'`, which changes the query's `FROM`
clause, not just its `WHERE`. The builder is deliberately scoped to
`vehicles`-table-only clauses so it stays a pure function independent of
which other tables might get joined in.

### `services/filter-search.service.ts`
Orchestrates the repository calls and owns the **zero-result relaxation
ladder**: if the initial filter set matches nothing, it tries, in order —
1. drop spec filters (body type, seats, etc. — the most speculative, "nice
   to have" constraints)
2. widen the mileage range ±15%
3. widen the year range ±1 year
4. drop the seat-count spec specifically

— re-counting after each step and stopping at the first one that produces
results. **Price is never in this list.** A buyer's stated budget is treated
as a hard constraint; if relaxation succeeds while a `maxPrice` was set, the
response's `relaxation.priceCeilingExceeded` flag is set instead, and the
frontend is expected to say "showing results slightly above your budget"
rather than silently exceeding it.

Also logs every search (filters, result count, timing) to
`marketplace.search_queries`, fire-and-forget — a failure to log must never
fail the search itself. `usedLlm` is always `false` on this path; the same
table is designed to be shared with the future NL pipeline, which is why
that column exists at all right now.

### `services/search-options.service.ts`
Backs `GET /search/options`. Returns the static enum lists from
`vehicle-attributes.constants.ts` plus a **type-scoped** make→model tree
queried from `marketplace.vehicle_dictionaries`. "Type-scoped" means: if the
request includes `?vehicleType=BIKE`, the make list returned is only the 10
makes that actually build bikes (Bajaj, Honda, Yamaha, …) — Toyota and Tata
are excluded, because their `vehicle_types` array on the dictionary row
doesn't contain `BIKE`. This is the entire reason the dictionary table grew
a `vehicle_types` column beyond its original design (see §6).

### `controllers/search.controller.ts`
Four routes, all public — no `@UseGuards()`. `GET /search/filters` (the main
path), `GET /search/facets` (standalone counts for the initial page load,
before any filter is set), `GET /search/options` (dropdown data), and
`GET /search/vehicles/:id` (one listing, for the detail page — gated on the
same `status = 'LIVE'` as search, so a link to a DRAFT or SOLD vehicle 404s
rather than confirming it exists). Browsing is deliberately anonymous: a
buyer must not need an account to look at inventory. There's no
gateway-level auth to route around — nginx does none, and Kong (which
previously did) was removed from this project entirely before this feature
was built.

### `search.module.ts`
Wires `SearchController` to both services and the repository, and is
registered in the app's root `AppModule`.

---

## 4. Database changes made for this feature

| Migration | What it does | Why |
|---|---|---|
| `1735000019000-SpecAndYearSearchIndexes` | Expression indexes on `(specs->>'seats')::int`, `COALESCE(registration_year, manufacture_year)`, and `mileage` | Without these, the year/seat/mileage filters above would force a sequential scan on every search |
| `1735000020000-ExtendVehicleTypes` | Widens the `vehicle_type` CHECK constraint from 6 values to 11 (adds `THREE_WHEELER`, `LORRY`, `PICKUP`, `TRACTOR`, `HEAVY_MACHINERY`) | The original enum only covered cars/bikes/vans/trucks/SUVs/buses — missing most of the actual Sri Lankan second-hand vehicle market |
| `1735000021000-DictionaryVehicleTypes` | Adds a `vehicle_types text[]` column to `vehicle_dictionaries` | Makes span multiple vehicle types (Toyota builds cars, vans, and lorries); without this column, a bike-scoped make dropdown couldn't exclude Toyota |
| `1735000022000-DictionaryNullParentUniqueness` | Adds a partial unique index on `(dictionary_type, canonical_value) WHERE parent_id IS NULL`, and cleans up existing duplicate rows | The table's original unique constraint includes `parent_id`, but Postgres never treats two `NULL`s as equal — so `ON CONFLICT` silently never fired for MAKE/BODY_TYPE rows (which always have `parent_id = NULL`), and re-running the seed script duplicated every make and body type with no error |

**Seed scripts** (`database/src/seeds/`):
- `vehicle-dictionaries.seed.ts` — 30 makes, 133 models, 10 body types,
  Sri Lanka-weighted (deep coverage for Toyota/Suzuki/Honda/Nissan/
  Mitsubishi, shallower for premium European makes), each MAKE/MODEL row
  tagged with the vehicle types it applies to.
- `vehicles.seed.ts` — 87 vehicles across 5 dealers (3 verified, 1 pending,
  1 rejected), deliberately shaped to exercise every edge case this feature
  depends on: ~36% with `registration_year = NULL` (to prove the COALESCE
  fix actually works), ~14% with sparse/empty `specs`, mixed statuses (so
  the `status = 'LIVE'` gate is provably excluding something), and price/
  mileage/year spread across realistic ranges.

---

## 5. Design decisions, and why they're not obvious

**Why UI filters skip the parser entirely.** The design doc for natural-
language search (`intelligent-search.pdf`) explicitly separates two entry
points: a buyer typing a sentence goes through tokenizing → rule-based
parsing → confidence scoring → (maybe) an LLM call. A buyer clicking
checkboxes already has structured data — running that through a text parser
would be pure overhead for zero benefit. This module implements only the
second path.

**Why `@>` containment instead of `->>'key' =`.** Both produce the same
result for an equality check on a JSONB key, but only the containment
operator can use `idx_vehicles_specs` (a GIN index). The arrow-and-equals
form forces Postgres to evaluate the expression on every row — correct
results, drastically worse performance as the table grows.

**Why year filtering never touches `registration_year` alone.** This was
the first decision made for this feature, verified with real numbers before
any code was written: on the seeded data, filtering `registration_year
BETWEEN 2015 AND 2020` directly returns 42 rows; filtering
`COALESCE(registration_year, manufacture_year) BETWEEN 2015 AND 2020`
returns 65. The 23-row gap is exactly the set of cars that would have
silently vanished from every year-filtered search because a dealer forgot
to enter a registration date — a data-entry gap, not a reason to exclude a
real, sellable vehicle.

**Why spec-key equality is validated in code (`KNOWN_SPEC_KEYS`), not left
to Postgres.** `specs` is untyped JSONB — nothing stops a request for
`specs=nonexistent_key:x` from reaching the database if the app layer
doesn't stop it first. Every spec filter is checked against the declared
key list and, for enums, the declared value list, before it ever becomes
SQL. This is the same "whitelist, don't trust" discipline the NL design doc
applies to LLM output, applied here to buyer-supplied query parameters.

---

## 6. What changed mid-build, and why

Two things in this feature grew beyond the original plan once real usage
revealed a gap — both are documented here so a future reader doesn't wonder
why the dictionary table has a column that wasn't in the earliest migration.

**`vehicle_dictionaries.vehicle_types`.** The original design only needed
the make/model dictionary for typo-correction in natural-language search. Once
the filter UI needed a "Make" dropdown that could be scoped to "only bikes"
or "only lorries," it became clear a flat make list was wrong — Toyota
builds cars and lorries but not bikes, so a bike-scoped dropdown showing
Toyota would be actively misleading. The `vehicle_types text[]` column and
its GIN index were added specifically to make that scoping query
(`WHERE vehicle_types @> ARRAY['BIKE']`) both correct and fast.

**Vehicle type enum, 6 → 11 values.** The original schema only had
`CAR/BIKE/VAN/TRUCK/SUV/BUS`. Building realistic seed data for the Sri
Lankan market surfaced that three-wheelers, pickups, lorries, tractors, and
heavy machinery are all real, commonly-traded categories with no home in
that enum. `SCOOTER` and `QUADRICYCLE` were considered and deliberately
**not** added — a scooter is a body style within `BIKE`, not a distinct
top-level category a buyer filters by first, so it lives in `specs.body_type`
instead (the same reasoning that keeps `body_type` and `seats` out of the
`vehicles` table entirely and inside JSONB).

---

## 7. What is deliberately NOT done yet

Being explicit about this so it isn't mistaken for an oversight:

- **Test coverage is unit-level only.** `filter-query.builder.spec.ts` (19
  tests) and `filter-search.service.spec.ts` (7 tests) cover the pure query
  builder and the relaxation ladder — the two places where a regression is
  both likely and invisible. Still missing: the parity test asserting the
  TypeScript constants match the live database `CHECK` constraints (see
  `vehicle-attributes.constants.ts`), and any end-to-end/HTTP-level test.
- **There is no CI workflow for this service or the frontend.**
  `.github/workflows/` covers api-gateway and auth-user-service only, so
  `npm test` here runs on developer machines and nowhere else. Adding one is
  a repo-wide decision, deliberately left to the team.
- **`mergeFilters()` (UI-wins-on-conflict semantics for when NL search and
  UI filters are used together) has not been written.** Nothing calls it
  yet because the NL parser it would merge against doesn't exist. It's
  mentioned in earlier design discussion but is not present in this
  codebase as of this document.
- **The natural-language search pipeline itself does not exist.** No
  tokenizer, no rule-based parser, no Groq/LLM integration, no pgvector
  query path. Only the "UI filters" entry point from the design doc's §10
  is built.
- **Saved listings are client-side only.** The frontend's save button and
  `/saved` page work and are gated behind auth, but `useSavedVehicles`
  persists ids to `localStorage` because `modules/favourites/` in this
  service is still an empty scaffold (the implementation lives on the
  unmerged `feat/MP-favourite` branch). That hook is the single file to
  change when it lands.
- **"Featured" listings do not exist** — no `featured` column, no backend
  concept, and the cosmetic placeholder that used to sit in `VehicleCard`
  has been removed rather than left to imply a feature.
- **No listing images exist yet, but the path is wired end to end.**
  `vehicle_images` is LEFT JOINed in both the search and detail queries and
  surfaces as `imageUrl` / `thumbnailUrl` / `images[]`; every environment
  currently has zero rows, so the frontend renders a silhouette placeholder.
  Uploading is the ingestion module's job and is not part of this feature.

---

## 8. Known bugs found and fixed during this build

Documented here because they're the kind of regression a reviewer or future
contributor should specifically watch for reintroducing:

1. **`specs` query parameter silently never worked.** Looked successful
   (no errors, correct-looking code) but every request containing a spec
   filter was rejected by `ValidationPipe`'s `whitelist: true` before it
   reached the query builder. Fixed by switching from a nested validated
   array to a flat transformed string (§3, `filter-search.dto.ts`).
2. **Multi-select spec filters always returned zero results.** Checking two
   body types produced an impossible `AND` condition. Fixed by grouping
   spec filters by key and OR-ing within a group (§3, `filter-query.builder.ts`).
3. **Every make and body type in the dictionary table was duplicated**
   (30 → 60 makes, 10 → 20 body types) after the seed script was run twice,
   with `ON CONFLICT DO NOTHING` silently failing to prevent it due to
   Postgres's `NULL ≠ NULL` semantics. Fixed with a partial unique index
   (§4, migration `22000`).
4. **`dealerVerified` and other boolean/numeric fields in API responses
   were quoted strings** (`"true"` instead of `true`) because the global
   `ValidationPipe` was missing `transform: true` — `class-transformer`'s
   `@Type()` decorators validated the string representation successfully
   but never actually mutated it. Fixed in `main.ts`.
5. **The frontend rendered a completely blank page** with no console
   errors. `main.tsx` contained the router `<App>` component instead of the
   `createRoot().render()` mount call — both files had ended up with the
   same content, so React never actually mounted anything. Fixed by
   restoring the correct mount code to `main.tsx`.
6. **Hiding the filter sidebar left a blank 280px gap** instead of the
   results grid expanding — the CSS grid's column template didn't change
   when the sidebar element was conditionally unmounted. Fixed with a
   conditional class that collapses the grid to a single column.

---

## 8b. Second round: correctness fixes and completion

A later pass over this module fixed the following. All are covered by the
unit tests in §7 except where noted.

**Backend**

1. **Facet counts collapsed to the selected value.** Every dimension was
   counted with all filters applied, including its own — so checking
   "PETROL" made the fuel facet return `PETROL (72)` and nothing else,
   destroying the one thing facet counts exist for ("how many more would I
   see if I also picked DIESEL?"). Each dimension is now counted against
   every filter *except* its own (`repository.facets()` takes the DTO and
   rebuilds the WHERE clause per dimension), and the five queries run
   concurrently instead of serially.
2. **The relaxation ladder under-reported what it did.** Steps accumulate,
   but the message named only the last one, so a search that had dropped
   specs *and* widened mileage *and* widened years claimed it had only
   "relaxed the year range". It now reports every step applied.
3. **The ladder's fourth step was dead code.** Step 1 set `specs: undefined`,
   so step 4's "drop the seats spec" filtered `undefined` and could never
   fire. Removed; steps that would change nothing are now skipped outright
   rather than consuming a wasted `COUNT` query.
4. **A mistyped keyword could not be relaxed.** `q` was immune to the
   ladder, so a typo returned zero results after fruitlessly widening
   ranges. It is now dropped first (after specs), ahead of numeric ranges.
   `hasRegistrationYear` was likewise added, ahead of the year range.
5. **`dealerVerified` was always `false` on a normal search.** It echoed the
   `verifiedDealersOnly` *filter* rather than the row's real state, so the
   "Verified" badge could only appear on a search that had already filtered
   to verified dealers — i.e. exactly where it carried no information. Now a
   real `LEFT JOIN auth.dealer_profiles` per row.
6. **`sort=relevance` ignored relevance.** It mapped to `created_at DESC`
   unconditionally; with a keyword present it now ranks by
   `ts_rank(search_vector, plainto_tsquery(...))`.
7. **`GET /search/facets` ran a whole search to throw it away** — including
   the relaxation ladder and an analytics INSERT — to return only counts. It
   now calls the repository directly.
8. **New:** `GET /search/vehicles/:id` for the detail page, gated on the same
   `status = 'LIVE'` as search (a direct link to a DRAFT or SOLD listing
   404s rather than confirming it exists). This lives here rather than on
   `ListingController` because that controller's `@Param('id', ParseIntPipe)`
   rejects every real vehicle id — they are UUIDs.
9. **New:** `vehicle_images` LEFT JOINed into search and detail
   (`imageUrl`/`thumbnailUrl`/`images[]`), `condition` added to the result
   projection, `districts` added to `/search/options`, and that endpoint is
   now cached in-process for 5 minutes.

**Frontend**

10. **Removing a price- or year-range chip cleared only half the range.**
    `removeKeys.forEach(onRemove)` fired two updates that both read the same
    pre-removal state, so the second overwrote the first and left `minPrice`
    applied. Replaced with a single multi-key removal.
11. **The first Enter in the keyword box searched without the keyword.**
    `updateDraft('q', …)` followed by `applyFilters()` published the draft as
    it was *before* the update, because `applyFilters` closes over the
    current render's draft. Keyword now writes straight to the URL.
12. **Spec filters were lost on reload, on a shared link, and on
    back/forward.** `specs` was never serialized into the URL, so the sidebar
    showed them as applied while the query no longer contained them. It now
    round-trips as the same flat `key:value` string the backend parses.
13. **Changing filters kept the old page number**, landing a buyer on page 5
    of a now-shorter result set — which reads as "your filter found nothing".
    Any change other than paging resets to page 1.
14. **`getSearchOptions` had no `.catch()`**, so a failed request became an
    unhandled rejection and the Make list silently stayed empty. All fetches
    now handle errors and abort on unmount.
15. **Filters the backend already supported were absent from the UI:**
    condition, district, model (cascading from make), previous owners,
    negotiable-only, seats, drive type, and sunroof. `condition` was the
    starkest — its facet was computed and returned on every request with no
    consumer.

---

## 9. Where things live, at a glance

```
marketplace-service/src/modules/search/
├── constants/
│   ├── vehicle-attributes.constants.ts   enum values, mirrors CHECK constraints
│   └── known-spec-keys.constants.ts      the specs JSONB whitelist — single source of truth
├── dto/
│   ├── filter-search.dto.ts              inbound query validation + specs parsing
│   ├── filter-search-response.dto.ts     outbound response shape
│   └── search-options-response.dto.ts    dropdown-data response shape
├── filters/
│   ├── filter-query.builder.ts           pure DTO → SQL WHERE clause function
│   └── filter-query.builder.spec.ts      19 unit tests — the SQL-shaping contract
├── repositories/
│   └── vehicle-search.repository.ts      runs the actual SQL against Postgres
├── services/
│   ├── filter-search.service.ts          orchestration + zero-result relaxation
│   ├── filter-search.service.spec.ts     7 unit tests — the relaxation ladder
│   └── search-options.service.ts         dropdown/dictionary lookups (5-min cache)
├── controllers/
│   └── search.controller.ts              the 4 public HTTP routes
└── search.module.ts                      wires it all together

web-frontend/src/
├── api/
│   ├── client.ts                         axios instance + auth/refresh interceptors
│   ├── auth.types.ts / auth.api.ts       auth-user-service contract + calls
│   ├── auth.storage.ts                   token/session persistence
│   ├── search.types.ts                   TS types mirroring the backend DTOs
│   └── search.api.ts                     filterSearch(), getSearchOptions(), getVehicleById()
├── auth/
│   ├── auth-context.ts / AuthContext.tsx the session provider
│   ├── useAuth.ts                        the consumer hook
│   └── RequireAuth.tsx                   route guard
├── hooks/
│   ├── useVehicleSearch.ts               draft vs. applied filter state, URL sync
│   └── useSavedVehicles.ts               saved ids (localStorage until favourites ships)
├── components/layout/
│   ├── Header.tsx                        brand, nav, auth actions
│   └── ErrorBoundary.tsx                 keeps a render crash off the blank page
├── components/search/
│   ├── FilterSidebar.tsx                 assembles every filter control
│   ├── SearchToolbar.tsx                 keyword search, filters toggle, sort
│   ├── CheckboxFacetGroup.tsx            multi-select filter (vehicle type, fuel, condition, ...)
│   ├── RadioFacetGroup.tsx               single-select filter (engine class, drive type)
│   ├── RangeInput.tsx                    min/max pair (price, year)
│   ├── PresetSelect.tsx                  single dropdown mapped to a preset value (mileage, seats, ...)
│   ├── MakeModelSelect.tsx               type-scoped cascading make → model
│   ├── VehicleCard.tsx                   one result card (links to detail)
│   ├── VehicleCardSkeleton.tsx           shape-matched loading placeholder
│   ├── SaveButton.tsx / YearDisplay.tsx / vehicle-format.ts
│   ├── ActiveFilterChips.tsx             removable, human-readable applied-filter pills
│   ├── SortDropdown.tsx / Pagination.tsx
│   └── EmptyState.tsx / RelaxationNotice.tsx
├── styles/app.css                        shell, auth, detail, drawer styles
└── pages/
    ├── SearchPage.tsx                    assembles the whole page
    ├── VehicleDetailPage.tsx             one listing, specs, dealer contact
    ├── LoginPage.tsx / RegisterPage.tsx  zod-validated auth forms
    └── SavedPage.tsx / NotFoundPage.tsx

database/src/
├── migrations/1735000019000 … 1735000022000   the 4 migrations this feature added
└── seeds/vehicle-dictionaries.seed.ts, vehicles.seed.ts
```
