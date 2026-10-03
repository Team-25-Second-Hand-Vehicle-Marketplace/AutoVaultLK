# Web Frontend

The AutoVault LK web app. It serves the public marketplace, the buyer and dealer portals, and the administrator console. Built with React 19, TypeScript, Vite and Tailwind CSS. Runs on port **5173** in development.

## Features

- **Public marketplace:** home page, natural-language and filter search, vehicle details, and saved vehicles.
- **Accounts:** buyer and dealer registration, e-mail verification, sign-in, forgot and reset password.
- **Dealer portal:** dashboard, profile, bulk CSV and ZIP upload with status and history, manual listing, and the listings page.
- **Administrator console:** dashboard, users, uploads, reports, audit logs and the vehicle dictionary.

## Routes

| Path | Page |
|---|---|
| `/`, `/search`, `/vehicles/:id`, `/saved` | Marketplace |
| `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` | Buyer accounts |
| `/dealer/login`, `/dealer/register` | Dealer accounts |
| `/dealer` | Dealer dashboard |
| `/dealer/listings`, `/dealer/listings/new` | Dealer listings and manual listing |
| `/dealer/profile` | Dealer profile |
| `/dealer/upload`, `/dealer/uploads`, `/dealer/uploads/:jobId` | Bulk upload, upload history and upload status |

The dealer portal sits behind dealer and verification guards.
| `/admin/login` | Administrator sign-in |
| `/admin/*` | Administrator console (dashboard, users, uploads, reports, audit logs, dictionary) |
| `/admin/preview` | Dashboard preview for design review |
| `*` | Not found page |

Protected routes use `RequireAuth` and `RequireRole` from `src/auth/`. Dealer pages also check verification and dealer type.

## Configuration

Copy `.env.example` to `.env` and fill in the values. Vite reads only variables prefixed with `VITE_`.

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Leave empty in development. Requests then go through the Vite proxy on the same origin. Set it to the deployed API gateway URL for other environments. |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID. It must match `GOOGLE_CLIENT_ID` in auth-user-service. It is public by design. |

In development, `vite.config.ts` proxies requests to the backend services, mirroring the routes in the API gateway:

| Prefix | Service |
|---|---|
| `/marketplace`, `/images` | Marketplace (3002) |
| `/auth`, `/users`, `/dealer-profiles`, `/documents` | Auth and user (3001) |
| `/ingest`, `/jobs` | Ingestion (3003) |
| `/admin` | Admin (3004) |

## Scripts

```bash
npm run dev          # development server on port 5173
npm run build        # type-check with tsc, then build for production
npm run preview      # serve the production build locally
npm run lint         # ESLint
npm test             # unit tests (Vitest, one run)
npm run test:watch   # unit tests in watch mode
```

## Testing

Unit tests use Vitest with Testing Library and jsdom. They live in `src/test/`, grouped by `api`, `auth`, `components`, `hooks`, `pages` and `utils`. Browser-level journeys are in the separate `e2e` package.

## Structure

```text
src/
├── api/          typed API clients, one per service area
├── auth/         auth context, route guards and token storage
├── components/   shared UI, grouped by admin, auth, dealers, landing, layout, search and ui
├── hooks/        data and search hooks
├── pages/        route pages (public, admin and dealers)
├── styles/       global styles
├── utils/        helpers
├── test/         unit tests
├── App.tsx       route table
└── main.tsx      entry point
```
