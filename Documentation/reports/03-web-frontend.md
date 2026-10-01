# web-frontend - Architecture & Flow Report

**Scope:** `web-frontend/` - the React SPA serving buyers, dealers and admins.
Written from the source as of 2026-09-28 (branch `main`).

---

## 1. What this is

A Vite + React 19 single-page app in TypeScript, talking to four backend services
through one gateway path space. Three distinct audiences share one bundle:

| Audience | Route prefix | Entry |
|---|---|---|
| Buyers (and anonymous visitors) | `/`, `/search`, `/vehicles/:id`, `/saved` | `/login` |
| Dealers | `/dealer/*` | `/dealer/login` |
| Admins | `/admin/*` | `/admin/login` |

Stack: React Router 7, Axios, Tailwind 4 (via the Vite plugin), `motion` for
animation, `react-hook-form` + `zod` for forms, `sonner` for toasts, `lenis` for
smooth scrolling, `jwt-decode` for token expiry checks. Tests are Vitest +
Testing Library + jsdom.

There is **no global state library** - no Redux, no Zustand, no React Query. State
lives in exactly three places, deliberately:

1. **The URL** - all search state (`useVehicleSearch`).
2. **React context** - the session (`AuthProvider`).
3. **Component-local `useAsyncData`** - everything else.

---

## 2. The gateway contract (`vite.config.ts`)

The dev proxy is the clearest single description of the platform's HTTP topology,
because each entry mirrors a `location` block in `api-gateway/local/nginx.conf` so
request paths are identical in dev and production.

| Path | Target | Prefix behaviour |
|---|---|---|
| `/marketplace` | `:3002` marketplace-service | **stripped** |
| `/auth`, `/users`, `/dealer-profiles`, `/documents` | `:3001` auth-user-service | preserved |
| `/ingest`, `/jobs` | `:3003` ingestion-service | preserved |
| `/admin` | `:3004` admin-service | preserved, **conditionally** |

Two subtleties worth carrying in your head:

- **Only `/marketplace` is stripped.** That is why every marketplace controller is
  bare (`@Controller('search')`, not `@Controller('marketplace/search')`) and why
  the marketplace Lambda has to strip the prefix itself.
- **`/admin` is ambiguous** - the SPA owns `/admin/login`, `/admin/users` etc., and
  so does the API. The proxy resolves it by inspecting `Accept`: `text/html`
  (a browser navigation) falls through to the SPA; anything else (XHR/fetch, which
  sends `application/json`) is proxied. In production nginx serves the SPA and the
  API separately and never has this ambiguity.

`VITE_API_BASE_URL` overrides the base; it defaults to `''` (same origin).

---

## 3. The HTTP client (`src/api/client.ts`)

One shared Axios instance, 10s default timeout, carrying the whole session lifecycle.

### Request interceptor - proactive refresh
Before each request (except auth endpoints), if a refresh token exists and the
access token is expired **or within a 30s skew window**, it refreshes *first*, then
attaches the fresh token. This avoids the common pattern of always eating one 401.

### Response interceptor - reactive refresh
On a 401 that isn't already retried and isn't an auth endpoint, it refreshes once,
marks `_retried`, and replays the original request. A second failure clears the
session and fires `onSessionExpired`.

### Single-flight refresh
`refreshPromise` ensures concurrent requests hitting expiry together trigger **one**
refresh, not N. `auth.api` is imported dynamically inside the refresh to avoid a
circular import.

### The session-expiry callback
`setSessionExpiredHandler` is how a plain module tells React the session died;
`AuthProvider` registers `() => setUser(null)` on mount. This keeps `client.ts` free
of React imports.

### Error helpers
- `toErrorMessage()` - unwraps Nest's `{ message: string | string[] }` shape,
  joining arrays (which is what a `ValidationPipe` failure returns), with distinct
  copy for timeouts and unreachable servers.
- `isNoResponseError()` - **true when a request went out but no response came back.**
  For a write this is genuinely ambiguous: the server may have completed it, so
  callers must not blindly resubmit. `DealerListingsPage` uses this to avoid
  creating duplicate listings.

### Token storage (`src/api/auth.storage.ts`)
Three `localStorage` keys (`autovault.accessToken` / `.refreshToken` / `.user`).
`isAccessTokenExpired()` decodes the JWT client-side purely to decide *when to
refresh* - never for authorisation, which is always the server's call. A corrupt
stored user clears the whole session rather than throwing.

> **Security note:** tokens in `localStorage` are readable by any script on the
> origin (XSS-exposed) - the conventional trade-off against `httpOnly` cookies,
> which would need CSRF handling and a same-site deployment. Worth recording as a
> deliberate choice.

---

## 4. Auth (`src/auth/`)

| File | Role |
|---|---|
| `AuthContext.tsx` | `AuthProvider` - session state + `login`/`loginAdmin`/`loginWithGoogle`/`register`/`logout`/`updateUser` |
| `auth-context.ts` | The context object, split out so Fast Refresh stays happy |
| `useAuth.ts` | Consumer hook |
| `RequireAuth.tsx` | Any authenticated user, else `/login` |
| `RequireRole.tsx` | A specific role, else a caller-supplied login route |

Initial state is read **synchronously** from `localStorage` in a `useState`
initialiser, so an authenticated reload never flashes a logged-out UI. A stored user
*without* a refresh token is treated as no session at all - it could not recover from
expiry, so the half-present session is cleared.

Both guards preserve `location` in navigation state so a post-login redirect can
return the user where they were. `RequireRole` checks `user?.role !== role` exactly -
an ADMIN visiting `/dealer` is redirected, not admitted.

Registration is interesting: `registerBuyer` may return **either** a token response
**or** a `{ message }` (email verification required). `isTokenResponse()` discriminates,
and only the token branch establishes a session.

---

## 5. The API layer (`src/api/`)

One module per backend concern, each a thin typed wrapper with a matching `.types.ts`:
`auth`, `admin`, `dealer`, `favourites`, `ingestion`, `listings`, `recommendations`,
`search`, `users`.

Notable decisions:

- **`search.api.ts`** serialises arrays to comma-joined strings and specs to
  `key:value,key:value` - exactly the flat format marketplace's `FilterSearchDto`
  expects (the nested-DTO whitelist problem documented on the backend).
- **`listings.api.ts`** raises the timeout to **60s** for create/update/image-upload:
  those re-embed a listing through MiniLM, and cutting the client off early does not
  stop the server - the listing is still created, the client just never hears.
- **`ingestion.api.ts`** raises it to **5 minutes** for the upload itself, and
  **deliberately does not set `Content-Type`** so the browser can add the multipart
  boundary. Field names are `csv`/`zip` because Multer rejects any other name with an
  unhelpful "Unexpected field" 400.
- **`ingestion.template.ts`** holds `TEMPLATE_HEADER`, `COLUMN_HELP` and `isRequired` -
  a **hand-maintained mirror** of ingestion-service's `csv-contract.ts`, used to
  generate the downloadable CSV template and the column reference.

---

## 6. Search (the buyer's main flow)

### `hooks/useVehicleSearch.ts` - URL as the single source of truth

Filters are serialised into the query string and parsed back out; there is no
duplicate React state holding "current filters". That gives shareable/bookmarkable
searches and working browser back/forward for free.

```
URL ?make=Toyota&minYear=2015&specs=body_type:SUV
  → paramsToFilters()   arrays split on ',', numbers coerced, booleans === 'true',
                        specs split on the FIRST ':' (values may contain one)
  → appliedFilters
  → effect fires a request
  → filtersToParams()   on every user edit, writing back to the URL
```

**Routing between the two backend search paths is one line:**

```ts
const request = appliedFilters.q ? nlSearch(...) : filterSearch(...)
```

A free-text `q` goes to `/search/nl` (parser → Groq → embeddings); structured filters
alone go to `/search/filters`. Both come back in the same response shape, so the page
renders them identically - the NL response merely adds a `parse` block.

Every request carries an `AbortSignal`; a superseded search is cancelled, and
cancellations are swallowed rather than surfaced as errors.

`logParseDiagnostics()` is **dev-only** and prints a collapsed console group showing
which strategy fired (`rules` / `groq` / `semantic` / `trigram`), the confidence, the
applied filters, unresolved tokens and any relaxation - a genuinely useful window into
the NL pipeline.

### `pages/SearchPage.tsx`
Layout and orchestration only. Sidebar is a column ≥1024px and an overlay drawer below,
with Escape-to-close and a backdrop. Result counts are announced via
`role="status" aria-live="polite"`, so they are not visual-only. Six skeleton cards
during load; smooth scroll-to-top on page change.

### Search components (`src/components/search/`)
`FilterSidebar`, `CheckboxFacetGroup`, `RadioFacetGroup`, `RangeInput`,
`MakeModelSelect`, `PresetSelect`, `SortDropdown`, `Pagination`, `ActiveFilterChips`,
`VehicleCard`, `VehicleCardSkeleton`, `EmptyState`, `YearDisplay`, `SaveButton`,
`RecommendationsSection`, plus two that surface backend behaviour directly:

- **`RelaxationNotice`** - renders the backend's zero-result relaxation message,
  including the "results may exceed your budget" case when a `maxPrice` was set.
- **`ParseWarning`** - surfaces low NL parse confidence / unresolved tokens.

`vehicle-format.ts` centralises price/mileage/year formatting so cards, detail pages
and dealer tables agree.

---

## 7. Dealer area (`src/pages/dealers/`)

### Layered guarding

```
/dealer/*        RequireRole('DEALER', loginTo='/dealer/login')
  index          DealerDashboardPage        - always renders; branches on status
  listings       RequireVerifiedDealer
  profile        (no extra guard)
  upload         RequireVerifiedDealer + RequireDealerType('business')
  uploads/:jobId RequireVerifiedDealer + RequireDealerType('business')
```

`RequireVerifiedDealer` exists because **a dealer can now log in while PENDING or
REJECTED** - approval no longer gates login in auth-user-service - so this, not login,
is what stands between an unverified dealer and the rest of the dealer area.

`RequireDealerType('business')` mirrors the backend split: bulk upload is
business-only, manual listing creation is individual-only. Both guards **fail closed**
(no render while loading or on profile error) and both exist *only* to avoid showing
a screen that would 403 on submit - the API enforces the same rules independently.

`/dealer` (the index) always renders something appropriate, which is why redirecting
there is always safe.

### `DealerListingsPage.tsx` (430 lines) - manual CRUD + the review queue

Covers FR-58 (manual listings) and FR-42/42.1 (bulk-upload review) in one screen.

- **Defaults to `sort=confidence_asc`** so rows most likely to need correction appear
  first, toggleable to newest-first.
- **`DELETABLE_STATUSES` is mirrored client-side** from `ListingService` so a Delete
  button never appears just to 409 on click; everything else offers Archive.
- Archiving asks for confirmation (`window.confirm`).
- Uses `isNoResponseError` so an ambiguous timeout does not prompt a resubmit that
  would create a duplicate listing.
- Per-row in-flight state (`archiving`/`approving`/`deleting`/`unarchiving`) keyed by
  id, so one row's spinner does not freeze the table.

### `NormalizationBadge.tsx` - where FR-42.1 closes

Renders the `normalization` JSONB that ingestion's Load stage wrote: per-field source
(`Parsed` / `Matched` / `As entered` / `AI-corrected`), confidence, and Groq's
reasoning where it repaired a value. Fields below **0.6** are flagged regardless of
source - the same `CONFIDENCE_FUZZY` floor the pipeline uses, so "low confidence"
means the same thing in both halves. Renders nothing for `normalization: null`
(manual listings, or rows predating migration 29000).

This is the visible end of a chain that starts in a dealer's CSV cell and runs through
dictionary resolution, Groq repair, provenance capture, JSONB persistence and a
confidence-ordered query.

### `BulkUploadPage.tsx`

- **Redirects to an active job on mount.** A dealer who submitted and navigated away
  otherwise has no route back; this sends them to the status page instead of a blank
  form they could resubmit into. A *failed* check does not block uploading - worst
  case is a double submit, which the pipeline tolerates.
- **Client-side validation mirrors `validateFile`**: `.csv` extension, non-empty, size
  cap - catching an `.xlsx` before a 25MB transfer.
- Real upload progress via `onUploadProgress`.
- Offers a generated CSV template and a `KnownValuesReference` (the accepted enum
  vocabularies) inline.

### `UploadStatusPage.tsx`

Polls `GET /jobs/:id` with **exponential backoff**: 2s → ×1.4 → capped at 15s,
**stopping entirely once the status is terminal**. Transient failures keep polling -
the job is still running and a dropped request should not strand the page.

Its `STATUS_COPY` table is careful about one thing in particular: **PARTIAL is
presented as a success** ("Completed with skipped rows"), because a dealer who reads
it as a failure re-uploads the whole file and creates duplicate work. The same concern
drives the backend's `PARTIAL → UPLOAD_COMPLETED` notification mapping.

`RejectionsReport` renders the paginated row-level report (FR-57) once the job is
terminal - before that the pipeline is still writing rejections and the page would be
a moving target.

### Other dealer files
`DealerRegisterPage.tsx` (437 lines, `zod` schema in `dealerRegisterSchema.ts`),
`DealerVerificationGate.tsx` (254 lines - the PENDING/REJECTED experience),
`DealerProfilePage.tsx`, `DealerLayout.tsx`, `DealerLoginPage.tsx`,
`useDealerProfile.ts` + `dealer-profile-context.ts` (profile fetched once per layout
mount and shared by both guards, not refetched per guard).

---

## 8. Admin area (`src/pages/admin/`)

`RequireRole('ADMIN', loginTo='/admin/login')` wrapping `AdminLayout`, with
Dashboard, Users, Uploads, Reports and Audit Logs. Charts are hand-rolled
(`BarRow`, `LineChart`, `PieChart` in `components/admin/`) rather than pulling in a
charting dependency.

`AdminDashboardPreviewPage` is **dev-only** - gated behind `import.meta.env.DEV`, so
it is stripped from production builds. It renders the real dashboard against fixed
mock data with no login, for checking a local change in the browser. Not linked from
anywhere.

---

## 9. Shared hooks

### `useAsyncData.ts`
The workhorse for every non-search fetch. A reducer over
`{data, error, loading}` plus:
- **Previous data is kept during a refetch**, so a refreshing table does not blank.
- **`setData(updater)`** applies a known server change locally instead of refetching -
  a caller that just performed the mutation already knows the resulting shape, and a
  reload would be a visible loading flash for zero new information.
- **`toMessage` is deliberately excluded from the effect deps**, with a long comment
  explaining why: an inline error formatter gets a new identity each render, and
  depending on it would create an infinite fetch loop.
- `reload()` bumps a nonce rather than changing `fetcher`.

### `useSavedVehicles.ts`
Favourites, **server-side** (FR-16/FR-17). Previously `localStorage`, which lost a
buyer's list on device switch while `marketplace.favourites` sat unused. The public
shape (`savedIds`, `isSaved`, `toggle`) survived the migration; **`toggle` is now
async**.

Implemented as a module-level `Map<userId, string[]>` synchronised via
`useSyncExternalStore` and a custom window event, so every hook instance agrees
without a context provider. The cache is cleared when the signed-in user changes, so a
second buyer on the same browser never sees the first's list.

**Guests get nothing here** - `SaveButton` prompts sign-in (FR-55) rather than saving
locally, because one source of truth beats an offline convenience that silently
disagrees with the server after login.

---

## 10. Layout, UI kit and landing

- **`layout/`** - `Header`, `Footer`, `BrandMark`, `ErrorBoundary`, `SmoothScroll`.
  The `ErrorBoundary` sits **inside** the router so a page crash keeps the header and
  navigation usable.
- **`ui/`** - `Button`, `FormField`, `SelectField`, `ErrorBanner`, `Pill`,
  `ActionMenu`, `AdminTable`, `SlotImage`, `VehicleTypeIcon`.
- **`landing/`** - `Hero`, `HeroSearch`, `StatsBand` (live figures from
  `/search/stats`), `CategoryBento`, `FeaturedRail`, `BrandMarquee`, `StoryScroll`,
  `DealerCta`, `CountUp`, `Reveal`.

`MotionConfig reducedMotion="user"` wraps the whole app, so every `motion` animation
respects `prefers-reduced-motion` without per-component handling.

`BARE_ROUTES` plus prefix checks hide the marketplace header/footer on dealer and
admin screens, which carry their own chrome.

`assets/image-slots.ts` supplies deterministic placeholder photos - which is exactly
what makes marketplace's `IMAGE_SERVE_MODE=demo` (resolving images to `null`) a
working default rather than a broken-image experience.

---

## 11. Testing

34 test files under `src/test/`, mirroring the source tree: API contract tests,
hooks, auth guards, dealer pages, admin pages, and UI components. Vitest + jsdom +
Testing Library.

The `*-contract.test.ts` files (`ingestion-contract`, `listings-contract`) are the
notable ones - they pin the request/response shapes the frontend assumes, which is the
cheapest available guard against silent backend drift given the services share no
generated client.

---

## 12. End-to-end flows

### A. Anonymous buyer searches
```
HomePage → HeroSearch → navigate('/search?q=...')
  → useVehicleSearch: q present → nlSearch()
  → GET /marketplace/search/nl  (proxy strips /marketplace)
  → results + parse block; dev console logs the strategy used
  → VehicleCard[] + facets + relaxation notice
  → SaveButton → not signed in → prompt to sign in (FR-55)
```

### B. Buyer saves a vehicle
```
login → AuthProvider.saveSession → tokens in localStorage
  → useSavedVehicles hydrates from GET /marketplace/favourites
  → toggle(id) → POST/DELETE /marketplace/favourites/:id
  → module store updated → useSyncExternalStore notifies every instance
  → SavedPage renders the same store
```

### C. Business dealer bulk uploads
```
/dealer/login → RequireRole('DEALER')
  → /dealer/upload: RequireVerifiedDealer + RequireDealerType('business')
  → mount: GET /jobs/active → redirect if one is running
  → pick CSV (+ ZIP) → client-side extension/size/empty checks
  → POST /ingest/upload (multipart, 5-min timeout, progress bar) → 202 { jobId }
  → navigate /dealer/uploads/:jobId
  → poll GET /jobs/:id  (2s → ×1.4 → 15s cap, stop on terminal)
  → terminal → GET /jobs/:id/rejections → RejectionsReport
```

### D. Dealer reviews and publishes ETL listings
```
/dealer/listings  (RequireVerifiedDealer)
  → GET /marketplace/listings/mine?sort=confidence_asc
  → PENDING_REVIEW rows first, least confident at the top
  → NormalizationBadge shows per-field source + confidence + Groq reasoning
  → PATCH /marketplace/listings/:id            (corrections)
  → PATCH /marketplace/listings/:id/approve    (→ LIVE, now buyer-visible)
```

### E. Session expiry mid-session
```
any request → interceptor sees token expired (30s skew) → refresh first
  refresh ok      → request proceeds, user never notices
  refresh fails   → clearSession() → onSessionExpired() → setUser(null)
                  → RequireAuth/RequireRole redirect to the right login page,
                    preserving `location` for a post-login return
```

---

## 13. Observations worth a maintainer's attention

1. **The ZIP size limit disagrees with the server.** `BulkUploadPage` rejects a ZIP
   over **25MB** (`MAX_UPLOAD_BYTES`, shared with the CSV check), while
   `IngestionUploadService` accepts up to **250MB**. Dealers with large photo sets are
   blocked client-side by a limit the backend does not impose.
2. **`ingestion.template.ts` is a hand-maintained copy** of the backend's
   `csv-contract.ts`. Nothing enforces parity, so a new required column added on the
   backend would silently leave the downloadable template stale.
3. **`AuthProvider.initializing` is permanently `false`** (`useState(false)` with no
   setter used). Both guards branch on it, so that branch is dead code - harmless
   today because the initial session read is synchronous, but misleading.
4. **Tokens live in `localStorage`** - XSS-exposed by design; see §3.
5. **`window.confirm` for destructive actions** in `DealerListingsPage` - functional,
   but inconsistent with the app's own modal/toast vocabulary.
6. **`logParseDiagnostics` is dev-gated**, so NL diagnostics vanish in production -
   worth knowing when debugging a live search complaint.
7. **The `/admin` proxy `Accept`-header trick is dev-only.** It works, but it means a
   dev-mode API call that fails to send a JSON `Accept` header will silently receive
   `index.html` instead of an API response.

---

## 14. Cross-service traceability

The three reports describe one continuous system. The clearest thread runs through
FR-42.1:

| Step | Where | Artifact |
|---|---|---|
| Dealer CSV cell | `inventory.csv` | `"toyata"` |
| Dictionary resolution | ingestion `PARSE_NORMALIZE` | fuzzy hit, confidence 0.6 |
| LLM repair | ingestion `GROQ_NORMALIZE` | `Toyota`, whitelisted, `source: 'groq'` |
| Provenance capture | ingestion `pipeline/types.ts` | `NormalizationProvenance` |
| Persistence | ingestion `LOAD` (the one cross-schema write) | `vehicles.normalization` jsonb |
| Review ordering | marketplace `findByDealer('confidence_asc')` | `rowConfidence ASC NULLS LAST` |
| Display | frontend `NormalizationBadge` | "AI-corrected · Make · 0.6" |
| Publication | marketplace `PATCH /listings/:id/approve` | `PENDING_REVIEW → LIVE` |
| Discovery | marketplace `/search/nl` | embedding built from the same shared module |

The second thread is the embedding parity requirement: `shared/normalize-embed/` is
byte-identical in marketplace-service and ingestion-service, and a listing created
manually must land in the same vector space as one bulk-uploaded - enforced by a
parity test, and invisible if it ever breaks.
