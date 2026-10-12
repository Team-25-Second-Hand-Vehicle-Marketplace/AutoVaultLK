# End-to-End Tests

Browser tests for the main AutoVault LK journeys, written with Playwright. They run against a running local stack or a deployed environment.

## Journeys

| Spec | What it covers |
|---|---|
| `buyer-registration.spec.ts` | Buyer sign-up and e-mail verification |
| `dealer-registration.spec.ts` | Dealer sign-up, then approval by an administrator |
| `dealer-bulk-upload.spec.ts` | Dealer CSV and ZIP upload, and the upload status page |
| `search-and-favourites.spec.ts` | Searching listings and saving a vehicle |
| `session-expiry.spec.ts` | Session expiry and sign-in again |
| `admin-dashboard-and-audit.spec.ts` | Administrator dashboard and audit log |

Page objects live in `pages/`. `helpers/admin-api.ts` calls the admin API directly to approve a dealer, and `helpers/session.ts` handles sign-in state.

## Prerequisites

1. Start the local stack from the repository root:

   ```powershell
   .\scripts\start-all.ps1
   ```

2. Install the Playwright browsers once:

   ```bash
   npx playwright install
   ```

3. Make sure the root `.env` contains `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`. The admin seed creates this account. The dealer journey uses it to approve dealers.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `BASE_URL` | `http://localhost:5173` | Frontend to test. Set it to a deployed URL to test that environment. |
| `ADMIN_SEED_EMAIL` | from root `.env` | Administrator account for the approval step |
| `ADMIN_SEED_PASSWORD` | from root `.env` | Password for that account |
| `CI` | unset | Enables retries, the GitHub reporter and the HTML report |

`playwright.config.ts` loads the root `.env` with `dotenv`.

## Running

```bash
npm test              # all journeys, Chromium and Firefox
npm run test:headed   # with a visible browser
npm run test:ui       # Playwright UI mode
npm run report        # open the last HTML report
```

To run one journey in one browser:

```bash
npx playwright test tests/search-and-favourites.spec.ts --project=chromium
```

## Design notes

- The suite runs one test at a time (`workers: 1`). Registration, login and resend requests all come from the same loopback IP, and the auth service rate-limits by IP. Running in parallel causes intermittent failures from that limit, so the suite does not retry them away.
- Failed tests keep a trace, a screenshot and a video under `test-results/`.
- Test data uses unique e-mail addresses per run, so reruns do not collide.

## Structure

```text
e2e/
├── playwright.config.ts
├── tests/      journey specs
├── pages/      page objects
├── helpers/    API and session helpers
└── fixtures/   files used by uploads, such as a verification document
```
