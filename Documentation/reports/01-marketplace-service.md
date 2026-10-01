# marketplace-service - Architecture & Flow Report

**Scope:** `marketplace-service/` - the buyer-facing catalogue and the dealer's
listing-management API. Written from the source as of 2026-09-28 (branch `main`).

---

## 1. What this service is

A NestJS 11 HTTP service (TypeORM + Postgres, port `3002`) that owns everything a
buyer sees and everything a dealer does to a listing *after* it exists:

- **Browse & search** - filter search, natural-language search, facets, options,
  vehicle detail, marketplace stats. All public, no auth.
- **Listing lifecycle** - create, update, approve, archive/unarchive, delete,
  image upload. Dealer/admin only.
- **Favourites** - buyer's saved vehicles.
- **Recommendations** - "similar vehicles" on a detail page.
- **Dealer profile reads** - a denormalised join into the `auth` schema.

It does **not** own users, auth issuance, or dealer verification - those live in
`auth-user-service`. It does not own bulk upload - that is `ingestion-service`.
It reads the `auth` schema directly (the "plan-b reads cross-schemas" decision,
`Documentation/plan-b-reads-cross-schemas.md`).

### Deployment shapes

| Entry point | File | Used by |
|---|---|---|
| Long-running HTTP server | `src/main.ts` | local dev, docker-compose |
| AWS Lambda handler | `src/lambda/marketplace-api.ts` | deployed environment |

Both build the identical `AppModule` with identical `ValidationPipe` settings.
The Lambda wrapper adds one thing: `stripMarketplacePrefix()`, which removes the
`/marketplace` path prefix from the API Gateway v2 event. Locally nginx strips it
via a trailing-slash proxy pass; API Gateway's Lambda-proxy integration cannot
rewrite paths, so it is done in code. **Consequence: no controller in this service
may carry a `marketplace/` prefix** - they are all bare (`@Controller('listings')`,
`@Controller('search')`, …), and this is called out in comments in
`favourites.controller.ts` because getting it wrong 404s every route behind the
gateway.

---

## 2. Cross-cutting infrastructure

### `src/main.ts` / `src/lambda/marketplace-api.ts`
Bootstrap. The `ValidationPipe` configuration is load-bearing and identical in both:

```ts
new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
```

- `transform: true` - query-string values are strings; `@Type(() => Number)` only
  actually coerces them when transform is on. Without it `dealerVerified` arrived
  as the string `"true"` and `minYear` as `"2015"`, which validated fine and then
  behaved wrongly downstream. This is documented in a comment because it was a
  real bug.
- `whitelist` / `forbidNonWhitelisted` - unknown query params are a 400, not
  silently ignored. This is what makes every DTO a genuine whitelist boundary.

`main.ts` additionally registers `ProductionExceptionFilter` globally; **the Lambda
entry point does not** - a difference worth knowing when comparing local and
deployed error bodies.

### `src/config/database.config.ts`
Single Postgres connection from `MARKETPLACE_DATABASE_URL`, default schema
`marketplace`, `synchronize: false` (migrations live in `database/`), pool capped
at `max: 5` (Lambda-appropriate), SSL toggled by `DATABASE_SSL`.

### `src/common/filters/production-exception.filter.ts`
Catch-all filter. Maps `HttpException` through faithfully; anything else is logged
server-side with a stack and rendered as a generic 500. In production
(`NODE_ENV=production` or `DISABLE_VERBOSE_ERRORS=true`) all 5xx messages are
replaced with `"Internal server error"` and the `error` field is omitted.
Deliberately duplicated from `auth-user-service` - the services share no package.

### `src/health/`
`GET /health` → `{ status: 'ok', service: 'marketplace-service' }`. No DB check.

### `src/config/image-serve.config.ts`
Three-mode image strategy, the single most important config decision in the service:

| Mode | Behaviour | Intended environment |
|---|---|---|
| `s3` | Presigns a time-limited GET against `MARKETPLACE_IMAGES_BUCKET` | production (NFR-19) |
| `local` | Streams from ingestion-service's `.storage` dir via an in-service route | dev, after a local ETL run |
| `demo` | Resolves nothing; frontend falls back to placeholder photos | **default** - fresh checkout |

Presign expiry is clamped to 900s to match the Terraform module's documented
ceiling; a misconfigured env var cannot produce a day-long URL. The function never
throws on misconfiguration - it returns the requested mode's config and lets the
image service degrade to `null` per image, because an image endpoint that 500s is
worse than one that shows a placeholder.

---

## 3. Authentication & authorization (`src/modules/auth/`)

This service **verifies** tokens; it never issues them.

| File | Role |
|---|---|
| `config/jwt.config.ts` | HS256 only (throws on any other algorithm), reads `JWT_ACCESS_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE` via `getOrThrow` |
| `strategies/jwt.strategy.ts` | Verifies signature/issuer/audience/expiry, then **re-reads the user from `auth.users` on every request** |
| `guards/jwt-auth.guard.ts` | Distinguishes expired (`TokenExpiredError`) from malformed (`JsonWebTokenError`) for clearer 401 messages |
| `guards/roles.guard.ts` | Reads `@Roles(...)` metadata; no metadata means no restriction |
| `decorators/current-user.decorator.ts` | `@CurrentUser()` → `{ id, email, role }` |
| `types/authenticated-user.type.ts` | `UserRole = 'BUYER' \| 'DEALER' \| 'ADMIN'` |

**The DB lookup in `validate()` is the important part.** A structurally valid token
is still rejected when the user is missing, `is_active = false`, or (for non-ADMIN)
has no `email_verified_at`. That means deactivation and email-verification take
effect immediately rather than at token expiry - at the cost of one query per
authenticated request.

---

## 4. Domain model (`src/infrastructure/database/entities/`)

| Entity | Table | Notes |
|---|---|---|
| `Vehicle` | `marketplace.vehicles` | The core listing. |
| `VehicleImage` | `marketplace.vehicle_images` | `s3_path` / `processed_path` / `thumbnail_path`, `is_primary`, `display_order`. Cascades on vehicle delete. |
| `Favourite` | `marketplace.favourites` | Unique on `(buyer_id, vehicle_id)`; cascades on vehicle delete. |
| `SearchQuery` | `marketplace.search_queries` | Analytics + the alias-promotion feed. |
| `VehicleDictionary` | `marketplace.vehicle_dictionaries` | Self-referencing MAKE→MODEL tree plus BODY_TYPE/COLOR, with `aliases jsonb` and `vehicle_types text[]`. |
| `AuthUserView` | `auth.users` (read-only) | `synchronize: false` view-entity. |
| `DealerProfileView` | `auth.dealer_profiles` (read-only) | PK is `user_id`; there is no separate id. |

### `Vehicle` - fields that carry design decisions

- **`status`**: `DRAFT | PENDING_REVIEW | LIVE | SOLD | ARCHIVED | REJECTED`. Only
  `LIVE` is ever visible to buyers; every search query hard-codes that.
- **`price`** is `numeric(14,2)` with a transformer, because `pg` returns numerics
  as strings. Same pattern on `SearchQuery.confidence`.
- **`specs jsonb`** - schemaless per-type attributes (`body_type`, `seats`,
  `load_capacity_kg`, …). Kept out of columns because a bike has no body type and
  a lorry has a load capacity nothing else does.
- **`normalization jsonb`** - FR-42.1 provenance written *only* by ingestion's Load
  stage: per-field `{source: rule|dictionary|raw|groq, confidence, reasoning?}` plus
  a `rowConfidence`. Null for every manually created listing. This service reads it
  (to sort the dealer review queue) and never writes it.
- **`needs_manual_review` / `review_reason`** - FR-35.2, set by ingestion's Enrich
  stage when a row has no registration number and therefore got no automated image
  match.
- **`search_text`** - the generated text that feeds the embedding.
- **`embedding`** - `vector(384)`, `select: false` so it never ships in a response.
- **`search_vector`** - tsvector maintained by a DB trigger; marked
  `insert: false, update: false` so application code cannot fight the trigger.

---

## 5. Module: listings (`src/modules/listings/`)

The dealer-side write surface. `ListingController` (`@Controller('listings')`):

| Route | Guard | Purpose |
|---|---|---|
| `POST /listings` | DEALER, ADMIN | Create |
| `GET /listings` | - public | All `LIVE` listings |
| `GET /listings/mine` | DEALER | Own inventory, every status |
| `GET /listings/:id` | - public | One listing, 404 unless `LIVE` |
| `PATCH /listings/:id` | DEALER, ADMIN | Edit |
| `PATCH /listings/:id/deactivate` | DEALER, ADMIN | → `ARCHIVED` |
| `PATCH /listings/:id/unarchive` | DEALER, ADMIN | `ARCHIVED` → `LIVE` |
| `PATCH /listings/:id/approve` | DEALER, ADMIN | `PENDING_REVIEW` → `LIVE` (FR-42) |
| `DELETE /listings/:id` | DEALER, ADMIN | Hard delete, restricted statuses |
| `POST /listings/:id/images` | DEALER, ADMIN | Replace image set (≤10 files) |

`/mine` is declared **before** `/:id` - otherwise Nest matches `"mine"` as a UUID param.

### `services/listing.service.ts` - the rules

- **Create is open to every dealer type, verified-only.** `assertManualUploadAllowed()`
  rejects `verificationStatus !== 'VERIFIED'`, regardless of `dealerType`. Business
  dealers can create a manual listing here in addition to bulk upload - the two paths
  are not mutually exclusive. Since auth-user-service now lets unverified dealers *log
  in*, this check is the only thing between an unverified dealer and a live listing.
- **Ownership** (`assertOwnership`) - ADMIN bypasses; otherwise `dealerId` must match
  the JWT subject. The forbidden message is deliberately identical to the not-found
  message so the endpoint cannot be used to probe which listing IDs exist.
- **`dealerId` is always taken from the token**, never the body. On update it is
  explicitly stripped - reassigning ownership is not an edit.
- **Duplicate guard** - an identical create from the same dealer within 2 minutes
  returns the existing listing instead of creating a twin (handles double-click /
  client timeout retry).
- **404 vs 409 discipline** - a missing listing is 404; a *real* listing in the wrong
  state for the action (approve a LIVE listing, unarchive a DRAFT) is 409, so the UI
  can tell the two apart. Every one of these methods re-checks after the write and
  maps a lost race to 409.
- **Delete is restricted to `DRAFT`/`PENDING_REVIEW`/`REJECTED`.** Anything that was
  or is `LIVE`/`SOLD`/`ARCHIVED` can only be archived, because a buyer's favourite
  pointing at a vanished listing is worse than one pointing at an archived one.
- **Image upload replaces the whole set**, not appends - a re-submission means "here
  is the current set".
- `withDealer()` degrades to `dealer: null` on lookup failure but logs missing-dealer
  and query-failure differently, so a DB outage does not look like missing data.

### `repositories/listing.repository.ts`
Owns the **search-index invariant**: `SEARCHABLE_FIELDS` lists the fields that feed
`buildSearchText()`; if an update touches any of them, `search_text` *and* `embedding`
are recomputed. `price` and `mileage` are in that list because they feed band phrases
("upper mid range" → "mid range").

`findByDealer(dealerId, sort)` supports `confidence_asc` (FR-42.1): orders by
`(normalization->>'rowConfidence')::numeric ASC NULLS LAST` so the least-confident
ETL rows surface first and manually-created rows (no provenance) sink to the bottom.

### `services/listing-search-index.service.ts`
Builds `{searchText, embedding}` from a vehicle. Caches the MiniLM embedder as a
process singleton (~90MB ONNX model). Honours `EMBEDDING_DISABLED=true` (keeps the
text, skips the vector) and **never fails a write** - an unavailable model logs a
warning and saves the listing with a null embedding.

---

## 6. Module: search (`src/modules/search/`) - the largest subsystem

Two entirely separate entry paths that converge on one SQL executor.

> **Note:** `src/modules/search/README.md` is an excellent but now-partly-stale
> document. It describes the UI-filter path only and states the NL pipeline is
> "unbuilt". The NL pipeline (parser, Groq fallback, embeddings, trigram, alias
> promotion) **is fully built and wired**. See §6.6 for other drift.

### 6.1 Routes (`controllers/search.controller.ts`)

| Route | Auth | Purpose |
|---|---|---|
| `GET /search/filters` | public | Structured filter search |
| `GET /search/nl` | public | Natural-language search |
| `GET /search/facets` | public | Standalone facet counts |
| `GET /search/stats` | public | Landing-page headline numbers |
| `GET /search/options` | public | Dropdown data, type-scoped |
| `GET /search/vehicles/:id` | public | Detail page (LIVE only) |
| `POST /search/aliases/promote` | **ADMIN** | Runs the alias-promotion loop |

Everything is public except alias promotion, which is guarded per-method rather than
per-class precisely because it writes to shared reference data the ETL also reads.

### 6.2 Path A - filter search

```
GET /search/filters?vehicleType=CAR&fuelType=HYBRID&maxPrice=5000000
   → ValidationPipe against FilterSearchDto        (whitelist boundary)
   → FilterSearchService.search()
       → buildFilterQuery(dto)                      (pure: DTO → WHERE + params)
       → repository.count()
       → if 0: relaxation ladder, re-count
       → repository.search()  +  repository.facets()  (parallel)
       → fire-and-forget INSERT into search_queries
   → FilterSearchResponseDto
```

**`filters/filter-query.builder.ts`** is a pure function - no DB access, fully
unit-testable - and the only place SQL fragments are written:

- Always emits `v.status = $1` (`'LIVE'`) first. Every relevant index leads with
  `status`.
- Column filters → `column = ANY($n::text[])`.
- Year filters use `COALESCE(registration_year, manufacture_year)` unless
  `hasRegistrationYear=true`. `registration_year` is nullable, and filtering it
  directly silently hid ~35% of inventory on seed data.
- Enum/bool specs → `v.specs @> '{"k":"v"}'::jsonb` (uses the GIN index).
  Int specs → `(specs->>'k')::int = $n` (has a dedicated expression index).
- **Same spec key → OR; different keys → AND.** Checking both "SUV" and "Sedan"
  must not demand a vehicle that is both.
- Unknown spec key or out-of-range value → `BadRequestException`, not a silent drop.
- `q` → `search_vector @@ plainto_tsquery('english', $n)`.
- Everything is parameterised; nothing is concatenated.

**`repositories/vehicle-search.repository.ts`** executes it. `verifiedDealersOnly`
is handled here, not in the builder, because it changes the `FROM` clause (a join to
`auth.dealer_profiles`) rather than the `WHERE` - keeping the builder pure. Three
public methods plus `findById`:
- `search()` - page of rows, with a `LEFT JOIN` for the primary image and dealer
  verification flag, then per-row image URL resolution in parallel.
- `count()` - pagination total and the zero-result trigger.
- `facets()` - five `GROUP BY` queries in parallel, each **dropping its own
  dimension's filter** so "Make" counts stay meaningful while a make is selected.
- `findById()` - detail row, gated on `status = 'LIVE'`, with all image paths
  aggregated (primary first) and dealer contact details.

**`services/filter-search.service.ts`** owns the **relaxation ladder**. On zero
results it loosens, in order, re-counting after each step and stopping at the first
that returns rows:

1. drop `specs`
2. drop `q` (keyword)
3. drop `hasRegistrationYear`
4. widen mileage ±15%
5. widen year ±1

**Price is never relaxed.** If relaxation succeeded while a `maxPrice` was set, the
response carries `relaxation.priceCeilingExceeded: true` and a message, rather than
silently exceeding the budget. Every search is logged to `search_queries`
fire-and-forget - a logging failure can never fail a search.

### 6.3 Path B - natural-language search

`services/nl-search.service.ts` orchestrates five stages:

```
q = "toyota corola hybrid under 5m low mileage"
 1. dictionaries.getParserVocabulary()      makes/models/bodyTypes + aliases
 2. parseQuery(q, vocab)                    deterministic, staged
 3. groqFallback.repair(...)                only if confidence < 0.6
 4. embeddings.embedQuery(semanticText)     MiniLM 384-dim, or null
 5. chooseSearchRank(...)                   pick ranking strategy
 → FilterSearchService.search(dto, log, rank)   ← same executor as Path A
```

**`parser/deterministic-parser.ts`** runs four ordered stages over tokens, each
marking tokens consumed so later stages cannot re-read them:

1. `stagePhrases` - multi-word exact hits (up to 3 tokens), min length 2.
2. `extractNumericSpecs` then `extractNumeric` - seats/doors/airbags, then
   price/year/mileage ranges.
3. `stageExact` - single-token exact: makes, then models, then closed enums/body types.
4. `stageFuzzy` - trigram matching for misspellings, rejecting digit-adjacent tokens.

Cross-field inference is built in: a model implies its parent make, and implies a
vehicle type when the model maps to exactly one. A model is only accepted if it is
consistent with an already-resolved make.

**Confidence = consumed meaningful tokens / total meaningful tokens**, rounded to 2dp.
Below `CONFIDENCE_THRESHOLD = 0.6` the parse is flagged `needsGroqFallback`.
Unconsumed tokens become `semanticText` - the input to embedding/trigram ranking.

**`parser/types.ts`** pins the shared thresholds: `TRIGRAM_THRESHOLD = 0.45` and
`AMBIGUITY_MARGIN = 0.05`. The margin is why "Corola" scoring 0.72/Corolla vs
0.71/Corsa resolves to *nothing* rather than a coin flip. Ingestion pins the same
numbers; a parity test exists to catch drift.

**Groq fallback (`groq/`)** - only fires when confidence is low *and* `GROQ_API_KEY`
is set. `llama-3.1-8b-instant`, `temperature: 0`, JSON response format, 1.5s timeout,
one retry on 429/5xx/timeout. The safety model is layered:
- The prompt ships the *allowed* vocabulary inline and forbids inventing values.
- `groq-whitelist.ts` re-validates everything regardless: enums against the constant
  lists, makes/models against the actual dictionary, numbers against hard ranges
  (year 1980–2100, price ≤ 500M, mileage ≤ 2M), specs against `KNOWN_SPEC_KEYS`,
  and `consumedTokens` against the actual unresolved token list. Anything else is
  dropped and logged.
- `mergeFilters()` - **rules always win**; Groq only fills gaps (ADR-004).
- Any failure at all (unconfigured, HTTP error, timeout, unparseable) logs a warning
  and returns the rules-only parse. The LLM can never break a search.

**Ranking (`filters/search-rank.ts`)** picks one of three strategies:

| Condition | Strategy |
|---|---|
| Embedding available | Order by `embedding <=> query::vector`; **also filter** by distance if no structured filters resolved |
| Leftover text + resolved filters | Order by `word_similarity()` on `search_text` |
| No filters resolved, raw text | `word_similarity()` order **and** a `>= 0.3` filter |

The distance cutoff is word-count-scaled (`maxEmbeddingDistanceFor`): 1 word → 0.85,
2 → 0.78, 3+ → 0.7. A single word embeds noisily; measured against seed data, a fixed
cutoff could not serve both "sporty" and "family friendly vehicle".

### 6.4 Alias promotion - the learning loop

`POST /search/aliases/promote` (ADMIN) closes the loop between failed searches and
the dictionary:

1. `findAliasCandidates(5)` - tokens appearing in ≥5 searches' `unresolved_tokens`.
2. Trigram-score each against every canonical dictionary value.
3. Promote **only** when: token length ≥ 4, not already a canonical/alias, best score
   ≥ **0.6**, and best beats runner-up by ≥ 0.05.

The 0.6 bar is deliberately stricter than the parser's 0.45: reading one query wrongly
costs one buyer one bad result set; writing an alias changes every future search *and*
every dealer upload the ETL normalises.

### 6.5 Supporting search files

- `constants/vehicle-attributes.constants.ts` - the canonical enum lists
  (`VEHICLE_TYPES` ×11, `FUEL_TYPES`, `TRANSMISSION_TYPES`, `CONDITIONS`,
  `SORT_OPTIONS`, `SEARCHABLE_STATUS='LIVE'`, page-size limits). Nothing else may
  hardcode these - `create-listing.dto.ts` derives its enums from here after a real
  bug where the DTO fell five vehicle types behind the database.
- `constants/known-spec-keys.constants.ts` - the `specs` JSONB schema: `body_type`,
  `seats`, `doors`, `drive_type`, `sunroof`, `airbags`, `engine_class`,
  `load_capacity_kg`, each with type and range.
- `services/search-options.service.ts` - dropdown data with a 5-minute in-process
  cache keyed by vehicle type, plus cached landing-page stats. Type-scoped makes
  (`vehicle_types @> ARRAY['BIKE']`) so a bike dropdown never offers Toyota.
- `filters/sort-clause.ts` - `SortOption` → `ORDER BY`. `relevance` resolves in
  priority order to embedding distance, then trigram, then `ts_rank`, then recency.
- `dto/filter-search.dto.ts` - the whitelist. `specs` is a flat
  `?specs=body_type:SUV,seats:5` string parsed by a custom `@Transform`, deliberately
  *not* a nested validated array: nested DTOs interact badly with `whitelist: true`.

### 6.6 Where the search README has drifted from the code

| README says | Code does |
|---|---|
| NL pipeline is "separate, unbuilt work" | Fully built: parser, Groq, embeddings, trigram, alias promotion |
| Relaxation ladder: specs → mileage → year → seat-count | specs → `q` → `hasRegistrationYear` → mileage → year (no seat step) |
| Four routes on the controller | Seven |
| "Test coverage is unit-level only", 26 tests | 45 unit + 3 integration + 10 e2e spec files |
| "`mergeFilters()` has not been written" | Implemented in `groq/groq-whitelist.ts` |

---

## 7. Module: images (`src/modules/images/`)

- **`services/image-url-resolver.service.ts`** - stored key → fetchable URL, per the
  three-mode config. In `s3` mode `getSignedUrl` computes a SigV4 signature
  **locally, with no AWS round trip**, which is what makes per-row resolution on a
  20-result page acceptable. In `demo` mode it returns `null` deliberately rather
  than the raw key - a null triggers the frontend's placeholder, a raw key produces
  a visibly broken `<img>`. A presign failure degrades one card, never the response.
  A missing bucket warns exactly once per process.
- **`services/image-upload.service.ts`** - writes uploaded bytes (S3 or local
  storage) and replaces the vehicle's image rows.
- **`controllers/local-images.controller.ts`** - `GET /images/local/*key`, dev-only.
  Refuses to serve unless the resolved mode is `local`, even though nothing links
  here otherwise. Uses `*key` (path-to-regexp v8 catch-all) because object keys are
  multi-segment; Nest 11 hands the param back as `string[]`, hence the join.
- **`safe-local-path.ts`** - path-traversal guard. A traversal attempt and a
  malformed key both surface as a plain 404, never a stack trace exposing the
  storage root.

---

## 8. Module: dealers (`src/modules/dealers/`)

A **read-only projection** of the `auth` schema. `DealerRepository.findById()` joins
`auth.users` (role `DEALER`, active) with `auth.dealer_profiles` into a
`DealerSummary`; both must exist or the result is null.

Routes (`@Controller('dealers')`): `GET /:id/profile`, `GET /:id`, `PUT /:id/profile`.

Two things to know:
- **`PUT /:id/profile` deliberately throws `NotImplementedException`** - dealer
  profile writes belong to auth-user-service. The DTO exists but is unused.
- **None of these routes is guarded.** Dealer profile data (company name, city,
  contact number) is treated as public catalogue information, consistent with it
  appearing on every vehicle detail page.

---

## 9. Module: favourites (`src/modules/favourites/`)

Class-level `@UseGuards(JwtAuthGuard, RolesGuard)` - every route needs a token; no
`@Roles` means any authenticated role. `POST /favourites/:vehicleId`,
`GET /favourites`, `DELETE /favourites/:vehicleId`.

Straightforward: duplicate add → 409, missing on delete → 404, list is
newest-first with the vehicle relation eager-loaded. Backed by a DB unique
constraint on `(buyer_id, vehicle_id)` as well as the service-level check.

Note the module comment: `JwtAuthModule` must be imported here because guards
referenced by class resolve against the declaring module.

---

## 10. Module: recommendations (`src/modules/recommendations/`)

`GET /recommendations/vehicles/:vehicleId?limit=6` (public, limit clamped 1–20).
404s if the vehicle does not exist.

`RecommendationsRepository.findSimilarVehicles()` is a single scored SQL query -
no ML, no embeddings. Additive score out of 100:

| Signal | Points |
|---|---|
| Same model | 30 |
| Same make | 20 |
| Same vehicle type | 15 |
| Similar price | 10 |
| Similar year / mileage / fuel / transmission / city | 5 each |

Images resolve through the same `ImageUrlResolverService`.

---

## 11. Shared: `src/shared/normalize-embed/`

**This directory is duplicated byte-for-byte in ingestion-service and must stay
that way.**

- `constants.ts` - `EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'`,
  `EMBEDDING_DIMENSIONS = 384` (must match the `vector(384)` column).
- `embedder.ts` - lazy `@xenova/transformers` pipeline, mean pooling, L2-normalised.
  Honours `EMBEDDING_MODEL_CACHE_DIR` so the Lambda image reads a baked-in model
  instead of downloading from the hub on cold start.
- `search-text.ts` - builds the embedded text. The key insight: **numbers are
  replaced by phrases**. MiniLM tokenises `3500000` into meaningless digit fragments,
  so price becomes `"budget affordable low price"` / `"mid range"` / `"luxury high
  end"`, mileage becomes `"low mileage lightly used"`, and age becomes a relative
  band. Exact numeric matching is SQL's job; the embedding carries what SQL cannot
  express.
- `vector.ts` - dimension assertion, L2 normalisation, `toPgVector()`.

**Change procedure** (from the file's own header): edit both copies identically →
add any new field to `SEARCHABLE_FIELDS` in `listing.repository.ts` → re-run
`database && npm run seed:embeddings` → note it in the plan-b §9A drift checklist.
Divergence produces no error, no failing test and no log line - just permanently
badly-ranked bulk-uploaded listings.

---

## 12. End-to-end flows

### A. Buyer filters the catalogue
```
SearchPage → useVehicleSearch → search.api.ts
  → GET /marketplace/search/filters?...
  → nginx / Lambda handler strips "/marketplace"
  → ValidationPipe coerces + whitelists → FilterSearchDto
  → buildFilterQuery → status='LIVE' + parameterised clauses
  → count → [relax if 0] → search + facets in parallel
  → per-row image presign (local SigV4)
  → log to search_queries (fire-and-forget)
  → { items, total, page, totalPages, appliedFilters, facets, relaxation }
```

### B. Buyer types a sentence
```
GET /search/nl?q="toyota corola hybrid under 5m"
  → vocabulary from vehicle_dictionaries (canonical + aliases)
  → deterministic parse (phrases → numerics → exact → fuzzy)
  → confidence < 0.6 ? Groq repair → whitelist → merge (rules win)
  → embed leftover semanticText (MiniLM)
  → choose rank: vector | trigram | none
  → SAME FilterSearchService.search() as flow A, plus rank
  → response + `parse` block (confidence, usedGroqFallback,
                              usedSemanticRanking, unresolvedTokens)
```
Unresolved tokens land in `search_queries.unresolved_tokens`, which later feeds
alias promotion - the loop that makes the parser better over time.

### C. Dealer creates a manual listing (any dealer type)
```
POST /listings  (Bearer token)
  → JwtAuthGuard: verify + re-read user from auth.users (active, verified)
  → RolesGuard: DEALER or ADMIN
  → ValidationPipe → CreateListingDto (enums derived from search constants)
  → assertManualUploadAllowed: status='VERIFIED' (any dealerType - business
    dealers may also use bulk upload, the two paths are not exclusive)
  → duplicate guard (same payload, same dealer, < 2 min)
  → buildSearchText + MiniLM embed  (never fatal)
  → INSERT, status defaults to 'LIVE'
POST /listings/:id/images
  → ownership check → replace entire image set → S3 or local storage
```

### D. Bulk-uploaded listing becomes visible (cross-service)
```
ingestion-service ETL
  → writes vehicles rows: status='PENDING_REVIEW',
    normalization{fields,rowConfidence}, needs_manual_review, search_text, embedding
  ↓  (invisible to every buyer-facing query - they all gate on status='LIVE')
GET /listings/mine?sort=confidence_asc
  → least-confident rows first, NULLS LAST
  → dealer reviews, PATCHes corrections
PATCH /listings/:id/approve
  → ownership + status must be PENDING_REVIEW (else 409)
  → status = 'LIVE'  →  now appears in search
```
This is FR-42: no ETL-loaded listing is public until its owning dealer approves it.

### E. Buyer opens a detail page
```
GET /search/vehicles/:id   → LIVE-gated row + all images + dealer contact
GET /recommendations/vehicles/:id?limit=6  → scored similar vehicles
POST /favourites/:id       → authenticated, 409 if already saved
```

---

## 13. Testing

| Layer | Location | Count | Runner |
|---|---|---|---|
| Unit | `test/unit/**` | 45 specs | `npm test` (default jest config) |
| Integration | `test/integration/**` | 3 specs | `npm run test:integration` (real DB, `--runInBand`) |
| E2E | `test/e2e/**` | 10 specs | `npm run test:e2e` |

The default `jest` config explicitly excludes `test/integration` and `test/e2e`, so
a bare `npm test` runs unit specs only. Unit coverage mirrors the source tree almost
one-to-one, with the heaviest concentration on the search parser, Groq whitelist and
query builder - the places where a regression is both likely and invisible.

---

## 14. Observations worth a maintainer's attention

These are factual notes from reading the code, not prescriptions.

1. **`src/modules/search/README.md` is stale** in five specific ways (§6.6). It is
   the first thing a new engineer reads about search, and it currently understates
   the system substantially.
2. **`ProductionExceptionFilter` is registered in `main.ts` but not in
   `lambda/marketplace-api.ts`.** Error response bodies therefore differ between
   local and deployed environments.
3. **`GET /dealers/:id` and `GET /dealers/:id/profile` are unauthenticated** and
   return `email` in the `DealerSummary`. Worth confirming that is intended, given
   the rest of the profile is genuinely public catalogue data.
4. **`PUT /dealers/:id/profile` always 501s** - dead route plus an unused DTO.
5. **One user-lookup query per authenticated request** (`JwtStrategy.validate`). A
   deliberate trade for immediate revocation, but it is the per-request cost floor.
6. **The embedder is a per-process singleton with a ~90MB model.** In Lambda this
   means a slow first invocation per cold container; `EMBEDDING_MODEL_CACHE_DIR`
   mitigates the download but not the load.
7. **`src/tools/reset-test-data.ts`** ships in `src/` and is compiled into `dist`.
8. **Many empty `.gitkeep`-only directories** (`common/guards`, `common/pipes`,
   `search/pgvector`, `search/trigram`, …) - scaffolding that was never filled,
   which can mislead a reader looking for where something lives.
