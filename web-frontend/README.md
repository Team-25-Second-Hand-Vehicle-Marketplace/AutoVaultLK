# web-frontend

The buyer-facing React app: vehicle search, listing detail, and buyer
accounts. Built with Vite + React 19 + TypeScript, talking to
`marketplace-service` and `auth-user-service` through the same paths nginx
exposes in a real deployment.

For how filter search works end to end (including the SQL it produces and why),
see [`marketplace-service/src/modules/search/README.md`](../marketplace-service/src/modules/search/README.md).

---

## Running it locally

You need three things up: Postgres, the two backend services, and this app.

```bash
# 1. Database (from the repo root) — Postgres on host port 5433
docker compose -f docker-compose.dev.yml up -d
# (or your existing vehicle_marketplace_postgres container)

# 2. Backend services, each in its own terminal
cd auth-user-service  && npm install && npm run start:dev   # :3001
cd marketplace-service && npm install && npm run start:dev  # :3002

# 3. This app
cd web-frontend && npm install && npm run dev               # :5173
```

Then open the URL Vite prints. If 5173 is taken it will pick the next free
port — use whatever it reports.

**The nginx gateway container is not required in development.** Vite proxies
the same path prefixes nginx does (see `vite.config.ts`):

| Path | Forwards to | Matches nginx block |
|---|---|---|
| `/marketplace/*` | `localhost:3002` (prefix stripped) | `location /marketplace/` |
| `/auth/*` | `localhost:3001` (prefix kept) | `location /auth/` |
| `/users/*` | `localhost:3001` (prefix kept) | `location /users/` |

The prefix is stripped for marketplace and kept for auth because that is what
the services themselves expect: `auth-user-service` mounts its own
`@Controller('auth')`, marketplace does not.

To point at a deployed gateway instead, set `VITE_API_BASE_URL` in
`web-frontend/.env`.

### Seed data

Search shows nothing without seeded vehicles. From `database/`:

```bash
npm run seed:dictionaries   # 30 makes, 133 models, 10 body types
npm run seed:vehicles       # ~160 LIVE listings across 5 dealers
```

There are no seeded BUYER accounts — register one through the UI at
`/register`.

---

## Routes

| Route | Auth | What it is |
|---|---|---|
| `/` | public | Landing page: hero search, stats, latest listings, categories, brands |
| `/search` | public | Filter sidebar, results grid, facets, pagination |
| `/vehicles/:id` | public | One listing: specs, description, dealer contact |
| `/login`, `/register` | public | Buyer sign-in and sign-up |
| `/dealer/login` | public | Dealer sign-in (split-screen layout) |
| `/dealer/register` | public | Four-step dealership registration wizard |
| `/saved` | **required** | Saved listings (redirects to `/login`) |
| `*` | public | 404 |

Browsing is deliberately anonymous — a buyer shouldn't need an account to
look at inventory.

The two `/dealer/*` routes render without the site header and footer: both
are full-bleed layouts that carry their own branding, matching the design.

### Dealer registration

Posts to `POST /auth/register/dealer`, which creates the `auth.users` row and
the `auth.dealer_profiles` row in one transaction. New dealerships start at
`verification_status = 'PENDING'`; the "Verified" badge on a listing reflects
that column, so a new dealer's listings show as unverified until an admin
promotes them.

Two fields from the design reference are deliberately **not** collected —
**VAT number** and **postcode** — because `auth.dealer_profiles` has no
column for either and anything typed would be silently discarded on submit.
`verificationDocuments` is sent as `{}` since no upload endpoint exists.

### Design notes

The visual language follows the marketplace design reference: a single blue
accent (`--accent`), light surfaces, soft card shadows, and a dark footer.
Tokens live in `src/styles/theme.css` and are applied by `home.css`
(landing/chrome/dealer screens) and `search-skin.css` (results and cards).
Those three load after `index.css`/`app.css` in `main.tsx`, so the redesign
is one reviewable layer rather than edits scattered through the originals.

Two places where the reference and this project's data disagree, resolved in
favour of the data:

- **Currency and locale.** The reference is a UK site (£, UK cities). The
  seeded inventory is Sri Lankan, so prices render as LKR and the location
  filters use real districts.
- **Headline numbers.** The reference shows figures like "58,400+ vehicles"
  and a "99.4% satisfaction rate". `GET /marketplace/search/stats` computes
  vehicle, dealer, brand, and per-category counts from live rows; the
  satisfaction and "happy buyers" figures are omitted entirely because this
  system has no orders or reviews to derive them from.

The hero uses a rendered gradient rather than the reference's photograph —
this project ships no licensed vehicle photography. `HomePage.tsx` documents
where to drop a real image in (`.hero__bg`) when one is available.

---

## How auth works

`auth-user-service` returns `{ accessToken, refreshToken, user }` from
`/auth/login` and `/auth/register/buyer`. The access token is short-lived
(15 minutes by default); the refresh token is single-use and rotated
server-side on every refresh.

- **`api/auth.storage.ts`** persists the session in `localStorage` so a page
  refresh doesn't sign the user out. `httpOnly` cookies would be safer, but
  the service returns tokens in the response body and has no cookie/CSRF
  handling on this branch — matching the contract that exists beats inventing
  half of a different one.
- **`api/client.ts`** attaches the token, refreshes proactively when it has
  expired, and retries once on a 401. Refreshes are **single-flight**: because
  refresh tokens are revoked on rotation, several concurrent requests each
  kicking off their own refresh would leave the first succeeding and the rest
  401-ing with an already-revoked token, logging the user out mid-session.
- **`auth/RequireAuth.tsx`** waits for the stored session to load before
  deciding, so a hard refresh doesn't bounce an authenticated user to
  `/login`, and remembers where they were headed.

### Not implemented, on purpose

Password reset and email verification have **no endpoints on this branch**
(they live on `feat/AUS-password-reset` and `feat/AUS-emailverification`), so
there is no "Forgot password?" link — an inert link that posts nowhere is
worse than its absence. Registration already handles the
`{ message }` response those branches introduce, so adopting them is a
backend merge plus a link.

`auth-user-service` also has no `ValidationPipe` and no validators on its
DTOs here, so it will accept a malformed email or a 2-character password.
`RegisterPage` validates with zod using the same rules
`feat/AUS-StrictValicationReq` enforces, so nothing the UI accepts today
starts failing when that merges.

---

## Notes on state

Filter state lives in **the URL**, not component state — searches are
bookmarkable and shareable, and the back button works. `useVehicleSearch`
only translates between `URLSearchParams` and the typed filter object.

The sidebar is **staged**: edits accumulate in a local draft and reach the
URL (and therefore the API) only when "Apply Filters" is pressed. Sort,
pagination, keyword submit, and chip removal bypass the draft and act
immediately, because each is already an explicit action.

Saved listings are stored per-user in `localStorage` (`useSavedVehicles`)
because `marketplace-service`'s favourites module is still an empty scaffold
on this branch. That hook is the only file that changes when the real API
lands.

---

## Scripts

```bash
npm run dev       # dev server with the proxies above
npm run build     # tsc -b && vite build
npm run lint      # eslint
npm run preview   # serve the production build
```

There are no frontend tests or CI workflow yet; `marketplace-service` has
unit tests for the search query builder and relaxation ladder
(`npm test` there).
