# AutoVaultLK — Load Testing Report

Written 2026-09-30, updated 2026-10-01 (end-to-end load restructured into five
levels, Levels 0-3 run), branch `Testing-Improvements`. Covers the k6-based performance
profiling and load-testing work done against the local development stack, under
`performance/`. Every number in this report is a real measured result from an actual
run against a live, seeded local instance of the services named — nothing here is
estimated or simulated.

**Staging/production status:** not yet run. A CloudFront-fronted deployed environment
became available during this work; running against it is scoped and ready (Section 7)
but deliberately paused pending budget confirmation, since every request against a
deployed AWS environment carries a real, metered cost (Lambda invocations, API Gateway
requests, RDS load) that a local run does not.

---

## 1. Why this exists

The Test Plan (`Test_Plan_Report_Group_25.md`, §3.3.4–3.3.5) calls for two related but
distinct techniques:

- **Performance Profiling** — single-user baselines for each critical transaction,
  established *before* any concurrent load, so a later load result can be attributed to
  contention rather than merely observed in isolation.
- **Load Testing** — load, stress, spike, soak and volume scenarios against the
  assembled system, run at concurrency the Test Plan's own risk model names explicitly:
  *"the risk is not that [buyer search and dealer ingestion] fail alone, but that one
  dealer uploading a large inventory degrades search for every concurrent buyer."*

Both techniques use **k6** (Grafana's open-source load-testing tool), installed
locally via `winget install k6` (v2.2.0). k6 is a CLI tool, not a hosted service — every
script here runs from a developer machine and sends real HTTP requests to whatever
`BASE_URL` it's pointed at, local or deployed. No AWS-specific or k6-Cloud-specific
tooling is used or required.

---

## 2. What was built

All scripts live in `performance/`, with shared config in `performance/config.js`
(the NFR-09-derived threshold: p95 response time under 500ms for CRUD/browse APIs, and
an error-rate ceiling of 1%).

| Script | Type | Purpose |
|---|---|---|
| `search-filters-baseline.js` | Baseline (1 user) | `GET /search/filters` — structured/filtered search |
| `nl-search-baseline.js` | Baseline (1 user) | `GET /search/nl` — natural-language search (real Groq LLM call) |
| `listing-detail-baseline.js` | Baseline (1 user) | `GET /search/vehicles/:id` |
| `dealer-ingestion-baseline.js` | Baseline (1 user) | One dealer, one small CSV upload, polled to completion |
| `login-favourites-load.js` | Load | 50 concurrent buyers (NFR-10's stated target), login once, loop favourites read/write |
| `end-to-end-load.js` | Load (combined, 5 levels) | Buyers (with NL search mixed in) **concurrently with** dealers each uploading a CSV (and, from Level 2, an image ZIP) — the actual risk scenario the Test Plan names. Size is chosen with `LEVEL=0..4`, see §2.1 |
| `dealer-ingestion-volume.js` | Volume | One dealer, five sequential uploads of increasing size: 100 → 500 → 2,000 → 5,000 → 15,000 rows |
| `buyer-traffic-stress.js` | Stress | Buyer browsing ramped in stages to 400 concurrent VUs (8× NFR-10's target), no assumed ceiling |

A second round added 6 more scenarios that the original set did not cover, identified as
explicit gaps. (A seventh, a standalone CSV+ZIP volume script, was later removed: its
coverage, CSV and images uploaded together, is now Levels 2-4 of `end-to-end-load.js`.)

| Script | Type | Purpose |
|---|---|---|
| `admin-service-load.js` | Load | Admin dashboard/users/uploads/audit-logs under 10 concurrent admin sessions — never exercised at any concurrency before |
| `nl-search-concurrency.js` | Load | `GET /search/nl` at real concurrency (15 VUs), unmixed with other traffic |
| `refresh-token-session-renewal.js` | Load | `POST /auth/refresh` under concurrent sessions — cookie/CSRF mechanics, never exercised at all before |
| `large-zip-upload-stress.js` | Stress (boundary) | A ZIP near (245MB) and just past (260MB) the service's real 250MB cap |
| `db-pool-exhaustion.js` | Stress (boundary) | 8 concurrent uploads against every service's 5-connection Postgres pool |
| `notification-delivery-load.js` | Load | `POST /notifications/events` under concurrency, including a deliberate same-key race to verify FR-53's idempotency guarantee holds under real concurrency, not just sequentially |

### 2.1 End-to-end load levels

`end-to-end-load.js` runs buyer traffic (filtered search, listing detail, favourites;
a share of buyers also issue natural-language search) and dealer uploads in the same
k6 process at the same time. `LEVEL` selects the size:

| Level | Buyers | Dealers | CSV rows per dealer | Images per dealer | Buyer hold | Purpose |
|---|---|---|---|---|---|---|
| 0 | 1 | 1 | 2 | 3 | 30s | Smoke: does the whole path work at all |
| 1 | 50 | 3 | 15 | none | 2m | NFR-10 target, CSV-only uploads |
| 2 | 50 | 3 | 15 | 60 | 3m | Same, with image processing |
| 3 | 200 | 10 | 50 | 200 | 4m | 4x buyers, 3x dealers |
| 4 | 400 | 20 | 150 | 600 | 8m | 8x buyers, ~7x dealers (**not run yet**, see §4.3) |

Levels 0 and 2-4 upload a pre-generated CSV+ZIP pair per dealer, built by
`performance/tools/generate-e2e-fixtures.sh <level>`. Registration numbers are
globally unique, so the pairs must be regenerated before every run. The share of
buyers issuing NL search falls with the level (20% / 10% / 5%) because every NL search
is a real Groq API call, and a high share of 400 buyers would trip Groq's own rate
limit instead of testing this system.

Each simulated user is sent with its own client IP (`X-Forwarded-For`), as real users
would be. All accounts registering from one IP would hit auth-user-service's per-IP
registration cap (max 100 per window) and test the rate limiter, not the system.
Buyers log in during `setup()`, not inside the measured window (Incident 5.19).

**Not built**, and why:

- **Spike** (sudden traffic burst, tests autoscaling/cold-start recovery) — meaningful
  only against a real Lambda deployment; a locally-running plain Node process has no
  cold start and no autoscaling to observe. Belongs with the staging work in Section 7.
- **Soak** (extended load over hours, checks for memory/connection leaks) — structurally
  unsuited to a shared development laptop that was in continuous use for other work
  throughout this session; needs a dedicated, isolated environment for a multi-hour
  unattended run.

---

## 3. CI wiring

| Workflow | Trigger | What it runs |
|---|---|---|
| `marketplace-service.yml` (existing workflow, extended) | Every push/PR touching `marketplace-service/**` or `performance/**` | `search-filters-baseline.js` as a 30-second smoke check — boots a real compiled marketplace-service against a migrated, seeded Postgres, then runs the baseline and gates on NFR-09 |
| `load-test.yml` (new) | `workflow_dispatch` only (manual) | `login-favourites-load.js` — the 50-VU load test, boots both auth-user-service and marketplace-service |
| `load-test-end-to-end.yml` | `workflow_dispatch` only (manual), `level` dropdown 0-4 | `end-to-end-load.js` at the chosen level; boots all four services, and generates the per-dealer fixtures first for levels 0 and 2-4 |

The manual-trigger design matches the Test Plan's own stated cadence (§5.2): a
reduced smoke-scale check on every push, full campaigns run on demand or scheduled —
never a 3+ minute, account-registering load test on every PR.

**Both workflows are verified against a real GitHub Actions run**, not just reasoned
about locally:

- `marketplace-service.yml`'s k6 step: confirmed green on push (run `36710473631`).
- `load-test.yml`: could not be triggered via `workflow_dispatch` before merging to
  `main` (GitHub only lists a `workflow_dispatch` workflow once its file exists on the
  default branch — confirmed by testing both the web UI path and `gh workflow run`,
  which returned the same 404). Verified instead by temporarily adding a scoped `push`
  trigger, confirming a real green run (`36712296609`, `login-favourites-load` job,
  4m36s, 22,414 requests, 0% failures, p95=6.85ms), then removing the temporary
  trigger — `workflow_dispatch` is the only trigger in the committed version.

**The gap-closing scripts are wired into CI**, each as its own
`workflow_dispatch`-only workflow, matching the existing `load-test*.yml` pattern
exactly (path-filtered service boot with dummy CI secrets, a Postgres service
container, migrate/grant/seed, then the k6 run):

| Workflow | Script | Notes |
|---|---|---|
| `load-test-admin-service.yml` | `admin-service-load.js` | Boots auth-user-service + admin-service only |
| `load-test-nl-search-concurrency.yml` | `nl-search-concurrency.js` | Passes `GROQ_API_KEY`/`GROQ_MODEL` from repo secrets/vars if configured — see caveat below |
| `load-test-refresh-token.yml` | `refresh-token-session-renewal.js` | Boots auth-user-service only; no admin seed needed |
| `load-test-large-zip-stress.yml` | `large-zip-upload-stress.js` | Generates the `--from-csv`-matched fixture pair in-job (Incident 5.15's fix); `IMAGE_PROCESSING_TIMEOUT_MS=15000` set explicitly; 30-minute job timeout given the ~250MB upload |
| `load-test-db-pool-exhaustion.yml` | `db-pool-exhaustion.js` | Boots auth-user-service + ingestion-service + admin-service |
| `load-test-notification-delivery.yml` | `notification-delivery-load.js` | Boots auth-user-service + notification-service; `SES_FROM_EMAIL` left empty so delivery is logged, not attempted for real |

**Deliberately batched, not done incrementally**: each script was built and verified
locally first, with CI wiring done as one pass once all were confirmed working — not
because they're less important, but because wiring several manual-dispatch workflows one
at a time, before knowing whether each script's design even worked, would have meant
repeatedly reworking committed CI files as bugs (like Incidents 5.14–5.16) were found
and fixed.

**Only one k6 check runs automatically**: the search-filters smoke check inside
`marketplace-service.yml`. Every `load-test*.yml` workflow, including every level of
the end-to-end load, is `workflow_dispatch` only. Level 0 is deliberately *not* wired
to push/PR either: booting all four services plus Postgres takes several minutes per
run, which is not worth paying on every change.

**Not yet run on real GitHub Actions** — verified only that each workflow file is
valid YAML and that its steps mirror the already-CI-verified `load-test*.yml` pattern
closely enough to be low-risk; none has had an actual dispatched run confirmed green
yet, unlike `load-test.yml` (§3's `36712296609`). `load-test-end-to-end.yml` was
changed in this round (level selector); its levels were run locally, not dispatched
on GitHub. A `workflow_dispatch` workflow's "Run workflow" button appears only
once the file exists on the default branch.

**`nl-search-concurrency`'s caveat carries into CI, not just local runs**: the new
workflow passes `GROQ_API_KEY`/`GROQ_MODEL` from `secrets.GROQ_API_KEY`/`vars.GROQ_MODEL`
if the repo has them configured — if not, marketplace-service boots with Groq
unconfigured and the job still runs and passes (Groq is optional per SAD 3.6.2; an
empty key skips it and falls back to the deterministic parser), but is then only
exercising the fallback path, not real Groq concurrency, the same caveat as Incident
5.10 applied to. Configuring these two repo settings is required to make this specific
workflow test what it says it tests.

---

## 4. Results

All results below are from the local dev stack (`scripts/start-all.ps1`): five NestJS
services as plain Node processes, Postgres via Docker Compose, seeded with ~244 live
vehicle listings. No Lambda cold starts, no real network latency to AWS — these numbers
establish that the **application logic** is not obviously broken; they say nothing
about real AWS instance sizing, RDS connection limits, or Lambda cold-start behaviour
(Test Plan §9.1, Environment Parity, is explicit on this point).

### 4.1 Single-user baselines

| Transaction | p95 | Threshold | Notes |
|---|---|---|---|
| Structured search (`/search/filters`) | 53–95ms | <500ms (NFR-09) | Three query shapes: unfiltered, multi-filter + verified-dealer join, sorted pagination |
| Listing detail (`/search/vehicles/:id`) | 20–60ms | <500ms | PK lookup with dealer/image join fan-out |
| NL search (`/search/nl`) | 154ms (one run had a 3.4s outlier) | <2000ms (SRS's own warm-start figure, not NFR-09) | Real Groq API call, not the deterministic fallback — `GROQ_API_KEY` is set locally |
| Dealer ingestion, 1 upload | 2.1–4.5s end-to-end (upload → COMPLETED) | No NFR; reported only | In-process pipeline, no Lambda cold start locally |

### 4.2 Load test — 50 concurrent buyers (NFR-10's stated target)

`login-favourites-load.js`, local run: 14,263 requests, **0% failures**, p95=418.52ms
(local machine) / **p95=6.85ms** (GitHub Actions runner, a cleaner, dedicated
environment — see Section 5.4 for why local and CI numbers differ this much).

### 4.3 End-to-end — multi-dealer + multi-buyer concurrent (the actual risk scenario)

`end-to-end-load.js`, levels 0-3 run locally on 2026-10-01, one at a time with
nothing else running. Level 4 has **not been run**. p95 is in milliseconds, against the
500ms NFR-09 bar (2,000ms for NL search).

| | Level 0 | Level 1 | Level 2 | Level 3 |
|---|---|---|---|---|
| Buyers / dealers | 1 / 1 | 50 / 3 | 50 / 3 | 200 / 10 |
| Per dealer | 2 rows, 3 images | 15 rows | 15 rows, 60 images | 50 rows, 200 images |
| Requests | 242 | 29,582 | 42,764 | 87,160 |
| Failed requests | 0% | 0% | 0% | 0% |
| Checks passed | 100% (187) | 100% (23,791) | 100% (34,404) | 100% (69,248) |
| `search_filters` p95 | 18 | 96 | 89 | **1,080 (fail)** |
| `vehicle_detail` p95 | 13 | 72 | 59 | **677 (fail)** |
| `get_favourites` p95 | 15 | 95 | 81 | **1,210 (fail)** |
| `save_favourite` p95 | 26 | 126 | 105 | **1,620 (fail)** |
| `nl_search` p95 | n/a | 126 | 91 | 1,310 (pass) |
| Ingestion job (per dealer) | 2.2s | 2.1-2.5s | 6.1-6.3s | 62-66s |
| Result | Pass | Pass | Pass | **4 latency thresholds missed** |

**Levels 0-2 pass comfortably**: 50 buyers with 3 dealers uploading, with or without
images, stays far under the NFR-09 bar. This answers the Test Plan's own risk question
at the NFR-10 target: concurrent dealer ingestion does not measurably degrade buyer
response times.

**Level 3 does not pass the latency thresholds, with zero errors.** Every request
succeeded and every one of the 10 dealer jobs reached `COMPLETED`, but buyer p95 for
four of five endpoints went to 0.7-1.6s. Dealer jobs also took 62-66s against 26s in an
earlier Level 3 run in which most buyers were not active (Incident 5.19), so the
buyer/dealer contention is real and measurable at this scale. This is a result for a
**single laptop running the four services, Postgres, Docker and k6 together**, not a
capacity limit of the product: on AWS each service has its own compute, so these
numbers cannot be carried over (§6).

**Level 4 (400 buyers, 20 dealers, 150 rows and 600 images each) is built but untested.**
Two earlier attempts crashed k6 with out-of-memory errors, but those were caused by
two runs overlapping (Incident 5.20), so they say nothing about Level 4 itself. Its
main risk on this hardware is memory: about 420 VUs plus 20 ZIPs of ~13MB each held in
k6 alongside the services.

An earlier version of this section reported 50 buyers + 3 dealers with `search_filters`
p95 of 179.67ms and 98.15% of checks passing; that run used the previous script, whose
buyer-to-account mapping was flawed (Incident 5.18). Level 1 replaces it.

### 4.4 Volume — one dealer, increasing file size

`dealer-ingestion-volume.js`, sequential (not concurrent) uploads of 100 → 500 → 2,000
→ 5,000 → 15,000 rows, each run to a real `COMPLETED` status before the next started:

| Rows | Time to COMPLETED | ms/row |
|---|---|---|
| 100 | 2.1s | 20.7 |
| 500 | 6.9s | 13.8 |
| 2,000 | 19.0s | 9.5 |
| 5,000 | 43.8s | 8.8 |
| 15,000 | 129.3s (2m 9s) | 8.6 |

Per-row cost **stabilises around 8.6–8.8ms/row** at larger sizes — near-linear scaling,
no cliff, no evidence of an O(n²) pattern or a missing index up to 15,000 rows.
**Not yet tested**: the practical ceiling (the 25MB CSV size cap, `ingestion-upload
.service.ts`'s `maxCsvSize`, is roughly 290,000 rows at this generator's average row
width — nowhere near reached).

### 4.5a CSV+ZIP volume — 600 rows, 1,800 real images (historical)

The standalone `dealer-ingestion-csv-zip-volume.js` was removed on 2026-10-01; CSV
plus images together is now covered by Levels 2-4 of the end-to-end load (§4.3). Its
single recorded run is kept here because the number is still the only large-image
data point: a 600-row CSV with a paired ZIP of 1,800 synthetic 800×600 JPEGs (3 per
vehicle), uploaded together, **COMPLETED in 244.5s (4m 4.5s)**.

- Contrast with the CSV-only volume test's ~13–15s extrapolated time for 600 rows:
  image processing (Sharp resize to 1600×1200 main / 400×300 thumbnail, per-image
  object-store write) is roughly **16× slower** than row processing alone — the
  dominant cost in a real dealer upload is the photos, not the data.
- Fixture size (600×3=1,800 entries) was not the original plan — see Incident 5.9.

### 4.5b Admin-service load — 10 concurrent admin sessions

`admin-service-load.js`: dashboard, users list, uploads list, and audit-logs, hit by 10
concurrent sessions sharing one real admin login (a small ops team's realistic usage
shape, not many independent accounts).

- **100% success** (1,964/1,964 checks)
- **p95 = 293.96ms**, under the 500ms NFR-09 bar

### 4.5c NL search concurrency — 15 VUs against the real Groq API

`nl-search-concurrency.js`: ramped to 15 concurrent VUs issuing real `GET /search/nl`
calls. First run (before Incident 5.10's Groq fix) returned 99.29% failures
(connection refused) and could not be root-caused from available evidence; an immediate
retry succeeded, and the failure did not recur. Re-run again after the Groq model fix
confirmed working:

- **100% success** (794/794 checks, 0 of 397 requests failed)
- **p95 = 673.46ms**, under the 2000ms SRS warm-start bar
- 397 real NL search calls completed, avg 153ms

**Important caveat this retroactively applies to §4.1's NL search baseline number
(154ms) above:** that baseline was measured *before* Incident 5.10 was found and fixed.
`GROQ_MODEL` was unset for the entire session up to that point, so every NL search
call — baseline included — was silently using the deterministic-parser fallback
(NFR-12.1), not a real Groq call, despite `GROQ_API_KEY` being present. The 154ms
baseline number is real, but it measured the fallback path, not the LLM path the test
was intended to measure. No new baseline run was taken after the fix; §4.5c's 153ms
average (now genuinely LLM-backed) is the closest trustworthy figure available.

### 4.5d Refresh-token / session-renewal — 5 concurrent sessions

`refresh-token-session-renewal.js`: 5 concurrent buyer sessions, each logging in then
performing 5 refresh cycles (25 total refreshes, deliberately kept under the
`AUTH_REFRESH_MAX_PER_IP=30`/15min per-IP ceiling — see Incident 5.11).

- **100% success** (50/50 checks — logins and refreshes both)
- `auth_refresh` **p95 = 53.8ms**, well under the 500ms bar
- Confirmed the httpOnly-cookie + CSRF-header refresh flow (never exercised before)
  works correctly under real concurrency, including reading the CSRF cookie out of
  each VU's own cookie jar per request

### 4.5e Large ZIP upload stress — boundary at the real 250MB cap

`large-zip-upload-stress.js`: one ZIP just under the real `maxZipSize` cap and one just
over it (deliberately over), random-byte fixtures built specifically for this test (see
script header — realistic photo content cannot reach this size within the 2,000-entry
ZIP limit). Took three attempts to get a trustworthy result — see Incidents 5.14–5.16.

- **Under-cap ZIP: accepted (202)** — correct, all three attempts
- **Over-cap ZIP: cleanly rejected (4xx)** — correct, all three attempts; no timeout, no
  crash, no 5xx
- **Final, correctly-matched run (245MB): job reached `COMPLETED` in ~6 seconds.**
  `PROCESS_IMAGES` itself completed in 5.3s, `DEGRADED` (all 50 random-byte entries
  correctly rejected as invalid images, 0 persisted — the correct outcome for this
  fixture's content).
- The first two attempts both appeared to hang for 5+ minutes without reaching a
  terminal state. Neither hang was what it first looked like: attempt 1 was an
  ingestion-service restart mid-flight (Incident 5.14); attempt 2 was diagnosed as a
  Sharp/timeout defect and "fixed" (Incident 5.16) on that theory, but attempt 3 — with
  the fix in place — hung again identically, which is what actually surfaced the real
  cause: a test-fixture bug where ZIP entry filenames never matched the CSV's
  registration numbers, so every image ran the full 30-second unmatched-retry budget
  serially (Incident 5.15). The `PROCESS_IMAGES` timeout (5.16) remains in place as
  real, independently-justified hardening, but is not what fixed this test.
- See Incident 5.12 for a real, separate finding this test surfaced: nginx's gateway
  cap for `/ingest/` (25MB) is far below this 250MB service-level cap.

### 4.5f DB connection-pool exhaustion — 8 concurrent uploads, 5-connection pool

`db-pool-exhaustion.js`: 8 concurrent dealers, each uploading a 100-row CSV at the same
moment, against a service whose Postgres pool (`extra: { max: 5 }`, confirmed identical
across all 5 services) has fewer connections than there are concurrent writers.

- **100% success** — every upload accepted, every status poll succeeded, every job
  reached a non-FAILED terminal state (0% `http_req_failed` across both tagged
  endpoints)
- p95 jumped to **8.76s** (vs. ~300ms median) — the expected signature of queuing
  behind a small pool, not failure
- **Confirms the pool degrades by queuing, not by erroring**, under real contention —
  the correctness bar this test exists to check (see Incident 5.13 for the related
  `INGESTION_MAX_CONCURRENCY` vs. pool-size mismatch this also surfaced)

### 4.5g Notification delivery load — concurrency + idempotency race

`notification-delivery-load.js`: 15 concurrent VUs, each sending one uniquely-keyed
notification event plus one deliberately shared idempotency key submitted by all 15 VUs
at the same moment — exercising FR-53's "never send twice" guarantee under real
concurrency rather than only the sequential case the unit/integration suites already
cover. Authenticates as an internal service (`X-Internal-Service-Key`), not as a user;
runs the full synchronous in-request path (`SES_FROM_EMAIL` empty locally, so delivery
is logged, not actually sent).

- **100% success** (30/30 checks)
- `notification_event` **p95 = 331ms**, under the 500ms bar
- **Verified directly against the database**, not just the HTTP response: exactly
  **one** row exists for the shared key, `status = SENT`, despite 15 concurrent
  submitters racing it — the idempotency guarantee holds under genuine concurrency.

### 4.5 Stress — buyer browsing ramped past the NFR-10 target

`buyer-traffic-stress.js`, ramped in stages to 400 concurrent VUs (8× NFR-10's 50):

- **99.99% success** — 1 failure out of 61,050 requests
- p95 = 599.28ms at 400 VUs (past the 500ms NFR-09 bar, which is expected and
  acceptable at 8× the documented target — a stress test is not gated on that
  threshold; its purpose is finding where things *start* to give)
- **No actual breaking point found** — the system remained stable through the full
  ramp; a higher `MAX_VUS` would be needed to find where it genuinely fails

---

## 5. Incidents and root causes

Every one of these was root-caused with direct evidence before being called "fixed" —
none were assumed or guessed. Several turned out to be problems with the test tooling
or the local environment, not the application; two were real application-level
findings worth a second look.

### 5.1 `URLSearchParams` is not defined (k6 runtime gap)

**Symptom:** `search-filters-baseline.js`'s first run reported all thresholds passing
with `0 out of 0` requests — a false-positive green result.

**Cause:** k6's JavaScript runtime (goja) is not a browser or Node environment; it has
no `URLSearchParams`. Every iteration threw before the HTTP call fired.

**Fix:** hand-built the query string instead. Additionally added a `handleSummary`
guard, now present in every script, that throws loudly if `http_reqs === 0` — this
class of "everything passed because nothing ran" failure cannot recur silently again.

### 5.2 Marketplace-service and auth-user-service missing required boot config in CI

**Symptom:** the CI smoke-check step failed with `TypeError: Configuration key
"JWT_ACCESS_SECRET" does not exist` — the service crashed on startup.

**Cause:** this was the first CI job in the repo to boot either service as a real,
full process rather than a NestJS testing module. auth-user-service additionally has
its own `Joi` startup validation schema requiring `AUTH_DATABASE_URL`,
`JWT_ACCESS_SECRET` (min 32 chars), and `INTERNAL_SERVICE_KEY` (min 16 chars) — none of
which any prior workflow needed to supply.

**Fix:** added the required dummy env vars (never real secrets) to both workflow
files. Verified by booting each service locally with the exact same env vars before
pushing, then confirmed green on the real GitHub Actions run.

### 5.3 `setup()` timing out with larger account counts

**Symptom:** `end-to-end-load.js`'s `setup()` (51 sequential account registrations)
exceeded k6's 60-second default `setupTimeout`, then still exceeded a 180-second
timeout after a first fix attempt.

**Cause, first pass (correct but incomplete):** each registration triggers a real
`bcrypt.hash(password, 12)` call server-side — a deliberately slow, CPU-bound security
operation (~100–300ms) — and the script sent registrations one at a time.

**Cause, actually dominant (found by direct measurement, not assumption):** a single,
completely isolated registration call — no load, no concurrency — was independently
timed at **4.97 seconds**. That is far more than bcrypt alone explains. Investigation
traced it to `VerificationEmailService.send()`: when `SES_FROM_EMAIL` is configured,
the service attempts a real AWS SES API call with a 5-second timeout
(`SES_TIMEOUT_MS`, default `DEFAULT_TIMEOUT_MS = 5000` — matching the observed delay
almost exactly). The auth-user-service process bound to port 3001 at the time was a
process manually started earlier in this session for a CI-fix verification test, not
the properly-configured process from `scripts/start-all.ps1` — it was running with a
different environment than the current `.env`.

**Fix:** killed the manually-started processes (which had also displaced the correct
`start:dev` watchers — 28 stray `node.exe` processes were found running at the same
time, mostly duplicates from earlier verification steps in this session that were
never cleaned up), then restarted the whole stack properly via `stop-all.ps1` /
`start-all.ps1`. Confirmed the fix directly: the same isolated registration call
dropped from 4.97s to 0.75s. Also switched `setup()` in both `end-to-end-load.js` and
`buyer-traffic-stress.js` from one-registration-at-a-time to `http.batch()` (concurrent
requests), further reducing setup time and avoiding the sequential bottleneck
regardless of environment health.

**Lesson recorded for future work in this repo:** manually starting a single service
with hand-typed env vars for a quick verification, and not tearing it down afterward,
can silently shadow the real dev-stack process on the same port with different
config — the two are indistinguishable from `curl http://localhost:PORT/health` alone
(both return 200). Always confirm via process inspection (`Get-CimInstance
Win32_Process -Filter "Name='node.exe'"` or equivalent) if something behaves
unexpectedly slowly and multiple service-boot attempts have happened in the same
session.

### 5.4 Local machine numbers vs. GitHub Actions numbers for the same test

**Observation, not a bug:** the 50-VU load test's p95 was 418.52ms locally but 6.85ms
on the GitHub Actions runner, for the identical script and identical thresholds.

**Explanation:** the local run shared the machine with the IDE, browser, and (per
§5.3) a significant number of stray background processes; the GitHub Actions runner is
a dedicated, otherwise-idle machine. Both are valid results for their respective
environments — this is the reason the Test Plan (§9.1) treats local and CI numbers as
informative but not equivalent to a staging/production measurement.

### 5.5 `open()` path resolution in k6 (volume test)

**Symptom:** `dealer-ingestion-volume.js` failed with `GetFileAttributesEx ...: The
system cannot find the path specified.`

**Cause:** k6's `open()` resolves paths relative to the **script file's own
directory**, not the working directory k6 was invoked from. A path written for one
level up (`../ingestion-service/...`) landed one directory short.

**Fix:** corrected to `../../ingestion-service/...` (two levels up from
`performance/scripts/` reaches the repo root). Confirmed by reading the exact
resolved path in the error message rather than guessing.

### 5.6 npm argument-forwarding silently dropped flags on Windows

**Symptom:** `npm run generate:vehicles -- --count 100 --format csv ...` generated
only 10 vehicles (the tool's own default), silently ignoring every flag.

**Cause:** npm's `--` argument-forwarding convention did not behave as expected in
this PowerShell environment — the flags were not reaching the underlying `tsx` script
as intended.

**Fix:** called `npx tsx src/tools/vehicle-generator/vehicle-generator.ts --count 100
...` directly, bypassing npm's argument-forwarding entirely. Confirmed the correct row
count in the generated file afterward rather than trusting the tool's own "Generated N
vehicles" log line at face value (it had also been wrong on the failing run).

### 5.7 Duplicate/stray registration numbers colliding across test runs

**Symptom (caught in the earlier Playwright work, applied here preventively):** a
hardcoded CSV fixture with a fixed `registration_number` collided with a row from an
earlier test run still present in the shared local database, since
`marketplace.vehicles.registration_number` carries a real unique constraint — the
**entire file** was rejected at the LOAD stage instead of exercising the intended
single-row validation failure.

**Applied here:** `dealer-ingestion-volume.js` rewrites every generated CSV's
`registration_number` column with a run-unique prefix (`K6VOL-<timestamp>-<row>`)
before upload — the vehicle-generator tool's own output is not unique across separate
runs (`generateRegistration()` returns `WP-0001`, `WP-0002`... starting from 1 in every
file), confirmed by reading the generator's source before this became a problem in
practice rather than after.

### 5.8 Missing `sleep()` on early-return paths — runaway iteration loop

**Symptom:** `buyer-traffic-stress.js`'s first 400-VU run reported
**43,414,629 iterations** in under 4 minutes — a number with no plausible relationship
to 400 real browsing sessions.

**Cause:** when a VU's login failed (46 out of 400 did, likely real contention from
400-way concurrent login attempts sharing a 50-account pool), the function returned
immediately without calling `sleep(1)`. That VU then re-entered the iteration loop
essentially instantly, forever, burning CPU on the k6 process itself rather than
reflecting real server load — and inflating every aggregate metric in the summary.

**Fix:** added `sleep(1)` to every early-return path, confirmed present in all three
scripts that share this login-once-per-VU pattern
(`buyer-traffic-stress.js`, `end-to-end-load.js`, `login-favourites-load.js`). Re-run
of the stress test after the fix produced a sane 30,427 iterations and a trustworthy
result (Section 4.5).

---

### 5.9 Undocumented `MAX_ZIP_ENTRIES = 2000` hard limit

**Symptom:** the first CSV+ZIP volume attempt (1,000 rows × 3 images = 3,000 entries)
failed with job status `FAILED`, reason "Photo archive has 3000 entries, which exceeds
the 2000 limit."

**Cause:** `validate-file.stage.ts` enforces `MAX_ZIP_ENTRIES = 2000` — a real backend
constraint with no prior mention in the Test Plan, the SRS, or any script comment found
before this. Discovered only by running the test at the originally-planned size and
reading the actual rejection reason off `GET /admin/uploads/:jobId/rejections`, not by
reading the source ahead of time.

**Fix:** regenerated the fixture at 600 vehicles × 3 images = 1,800 entries, safely
under the limit while still exercising real volume. Not a bug — a genuine, now-documented
constraint worth carrying into future capacity-planning conversations.

### 5.10 Groq model 404 — NL search silently running on the fallback parser

**Symptom:** marketplace-service's own terminal log, pasted mid-session, showed
repeated `[GroqFallbackService] Groq unavailable (Groq HTTP 404); proceeding with
rules-only filters` warnings — not a crash, but a real functional gap.

**Cause:** `groq-client.ts`'s `DEFAULT_MODEL = 'llama-3.1-8b-instant'` is a Groq model
that has since been deprecated/removed from Groq's catalog. With no `GROQ_MODEL`
override set in `.env`, every Groq API call this entire session — including the
original NL-search baseline reported in §4.1 — returned HTTP 404 and silently fell
back to the deterministic parser (NFR-12.1's own designed fallback behaviour, working
exactly as intended, which is precisely why nothing looked broken from the outside: every
NL search still returned correct results).

**Fix:** added `GROQ_MODEL=openai/gpt-oss-20b` (a current, real Groq model) to `.env`,
then restarted marketplace-service — NestJS's `ConfigModule` reads `.env` once at
process boot, and `nest start --watch` only recompiles TypeScript, it does not reload
environment variables (confirmed: the process PID stayed at 25844 across the `.env`
edit with zero effect on behaviour, until an actual restart changed it to 30948).
Verified directly: the same Groq-requiring query (`needsGroqFallback:true`) returned
`usedGroqFallback:false` before the restart and `usedGroqFallback:true` immediately
after.

**Retroactive impact:** every NL-search number in this report measured *before* this
fix (§4.1's baseline) was exercising the fallback path, not the LLM path it was meant
to measure — see the caveat attached to §4.5c.

### 5.11 `AUTH_REFRESH_MAX_PER_IP` is a per-IP, not per-user, ceiling

**Not a bug — a design constraint the refresh-token test had to be built around.**
`assertRefreshAllowed` (`auth-abuse-protection.service.ts`) counts refresh attempts by
IP address, not by user or session. Every k6 VU run locally shares one IP
(`localhost`), so `AUTH_REFRESH_MAX_PER_IP=30` / `AUTH_REFRESH_WINDOW_MINUTES=15` is a
**ceiling for the whole test run**, not a per-session budget the way it would be against
real, distinct client IPs in production. `refresh-token-session-renewal.js`'s default
(5 sessions × 5 refreshes = 25 calls) was sized to stay under this shared-IP ceiling
deliberately; a staging run behind real distinct IPs would not hit it the same way.

### 5.12 Gateway ZIP-size cap (25MB) is far below the service-level cap (250MB)

**Finding, surfaced while building the large-ZIP stress test, not a bug that was
fixed — flagged for a deployment-topology decision.** `ingestion-upload.service.ts`
enforces a real `maxZipSize = 250MB`. Separately, `api-gateway/local/nginx.conf`'s
`/ingest/` location sets `client_max_body_size 25m`. A request that size sent *through*
the gateway (port 8080, the only path real dealer traffic would take in a deployed
system) would be rejected by nginx with a bare 413 long before the service's own 250MB
check ever runs — meaning the 250MB check is effectively unreachable dead code for
gateway-routed traffic as currently configured. This test (like every other ingestion
script in this repo) bypasses the gateway and hits ingestion-service directly on port
3003, so it exercises the service-level cap but not this mismatch directly. **Needs a
decision, not a fix from this work alone:** if 250MB end-to-end is the real intent,
nginx's cap needs raising to match; if 25MB is the real intended ceiling, the
`maxZipSize` check (and this test's whole premise) should be revisited downward.

### 5.13 `INGESTION_MAX_CONCURRENCY` (10) exceeds the DB pool size (5) — by design, confirmed safe

**Finding, confirmed safe by the pool-exhaustion test, not a defect.** `.env`'s own
comment says `INGESTION_MAX_CONCURRENCY` should be "kept in step with `extra.max` in
database.config.ts," but the actual values are 10 and 5 respectively — every service's
pg pool caps at 5 connections (confirmed identical across all 5 services by direct
grep), while the ETL pipeline's own chunk concurrency allows up to 10 simultaneous
chunk-processing slots. This means pool contention is a **latent, already-designed-in**
condition in the pipeline's own concurrency model, not something `db-pool-exhaustion.js`
invented. §4.5f's result — 100% success, with the pool degrading via queuing
(p95=8.76s) rather than errors — confirms the mismatch is currently safe in practice
(TypeORM's pool queues callers rather than rejecting them), but the comment in `.env` is
inaccurate and worth correcting or reconciling with the real values.

### 5.14 In-flight ETL jobs are silently orphaned on an ingestion-service restart

**Symptom:** the large-ZIP stress test's accepted 245MB job (§4.5e) never left
`PROCESSING`. Investigated directly rather than assumed: the raw `images-230mb.zip`
and `inventory.csv` are still sitting, untouched, under
`ingestion-service/.storage/raw/<jobId>/`; no `images/<jobId>/` output directory was
ever created (confirmed via `find` — zero processed images exist for this job); and
the job row's own `updated_at` is **2 seconds** after `created_at`, with nothing since.

**Cause, confirmed via direct evidence, not guessed:** `InProcessJobQueue.publish()`
(`infrastructure/queue/in-process-job-queue.ts`) hands the ETL run to a detached
`setImmediate` callback, fully independent of the HTTP request that triggered it —
this part is correct and by design, documented in the file's own comment ("so
`POST /ingest/upload` can answer 202 without waiting for the ETL run"). The actual
cause: `Get-Process` showed the current ingestion-service process (PID 15984) started
at **22:44:44**, roughly **2 minutes after** this job was created (22:42:50) and last
updated (22:42:52). The process running this job was restarted while the job was
mid-flight. The in-memory `setImmediate` callback — and whatever promise chain was
awaiting Sharp/object-store calls inside it — died with the old process. **Nothing
reconciles orphaned `PROCESSING` rows on startup**: the new process has no code path
that scans for jobs left mid-state by a previous instance and marks them `FAILED` or
resumes them. The row is permanently stuck, indistinguishable from a real slow job
without checking process start time against the row's own timestamps, the way this
investigation had to.

**Not the explanation this report first gave.** An earlier draft of this section
attributed the delay to slow per-image Sharp decode attempts against the stress test's
random-byte fixture content (a real, separately-true fact — `image-processing.stage.ts`
has no per-image timeout, and decoding genuinely-invalid image bytes is slower than a
valid JPEG's metadata read) — but that was a plausible-sounding guess made without
checking the actual job/process timestamps, and turned out not to be what actually
happened here. The job was not slow; it was abandoned 2 seconds in. Both things can be
true at once — the missing per-image timeout is still a real, distinct gap — but only
the restart is what actually explains this specific stuck job.

**Not fixed.** This is an operational gap worth flagging for follow-up, not something
resolved by this testing pass: a production/staging deployment on the `sqs`/Step
Functions driver would not have this exact failure mode (Step Functions has its own
durability and retry semantics), but the `inprocess` driver — the only one currently
built, per `INGESTION_QUEUE_DRIVER`'s own doc comment — has no recovery path for a
mid-flight process restart, local dev or otherwise. Raw files for the orphaned job
(`2365c14e-1547-4eb7-b4d7-b9a1f2d6f1a2`) were left in place rather than deleted, in
case they're useful for reproducing or fixing this.

### 5.15 Large-ZIP job appeared to hang twice — actual cause was a test-fixture bug, not a backend defect

**The large-ZIP stress test was re-run** specifically to separate Incident 5.14 (a
one-off restart) from whatever else might be going on, this time with
ingestion-service confirmed already running for several minutes *before* the job
started — ruling out another restart. The under-cap job **hung again**, looking
identical to Incident 5.14's symptom: `ingestion.etl_stage_logs` showed every CSV-row
stage (`VALIDATE_FILE` through `LOAD`) completed in under 6 seconds, while
`PROCESS_IMAGES` sat at `status = STARTED`, `completed_at = NULL`, for 5+ minutes with
the service otherwise responsive throughout.

**First (wrong) conclusion:** this looked like Sharp hanging indefinitely on the
fixture's random-byte "images," with no timeout to cut it short — a plausible-sounding
explanation given `processVehicleImage()` (`image-processing.stage.ts`) wrapped none of
its `sharp()` calls in a timeout. A fix was written on this theory (Incident 5.16) and
the test re-run to verify it — and hung a **third** time, on the same symptom, even
with the fix in place and confirmed loaded (process restarted, new PID). That result
directly contradicted the theory and forced a harder look rather than accepting a
guess a second time.

**Actual root cause, found by checking what was actually loaded, not assumed:**
`generate-oversized-zip.ts` (the fixture generator written for this test) always named
every ZIP entry `STRESS-0001.jpg`, `STRESS-0002.jpg`, etc., **regardless of the paired
CSV's real registration numbers** — which were `K6STRESS-0`, `K6STRESS-1`, etc. Every
one of the 50 images was therefore permanently unmatched to any vehicle row.
`process-job-images.service.ts`'s `findVehicleWithRetry` polls for up to
`MATCH_RETRY_BUDGET_MS` (30 seconds) per image before giving up on a genuinely
unmatched registration — 50 images × 30s run serially is **~25 minutes**, which is
indistinguishable, by symptom alone, from a true `PROCESS_IMAGES` hang for any
observation window under 25 minutes (every check in this investigation, across three
runs, was made well before that point). The job was never stuck; it was legitimately,
slowly working through a real, by-design retry loop against a fixture that could never
succeed at matching.

**Confirmed by fixing the actual bug and re-running:** `generate-oversized-zip.ts` was
given a `--from-csv` option (reusing `image-generator.ts`'s own
`registrationsFromCsv()` pattern) so ZIP entries are named after real CSV registration
numbers. A fresh, correctly-matched 245MB fixture pair
(`k6-stress2-50.csv` / `k6-stress2-245mb.zip`) was generated and the test re-run: the
job reached `COMPLETED` in **3 polls (~6 seconds)**, not 5+ minutes.
`ingestion.etl_stage_logs` showed `PROCESS_IMAGES: DEGRADED`, completed in **5.3
seconds** — Sharp rejected all 50 random-byte entries quickly once actually reached
(each correctly classified as a per-image `'failed'` outcome by the existing
`isImageProcessingFailure` handling, confirmed via `marketplace.vehicle_images`: 0 rows
persisted for these vehicles, as expected for genuinely invalid image data). Sharp was
never the bottleneck in any of the three runs — the retry loop was.

### 5.16 `PROCESS_IMAGES` timeout added as real hardening, despite not being Incident 5.15's actual cause

**Applied before Incident 5.15 was fully root-caused** — on the reasonable-at-the-time
theory that Sharp was hanging on malformed image bytes — and kept after the real cause
(the fixture's unmatched filenames) came to light, because the underlying gap it
closes is real regardless: `image-processing.stage.ts`'s `processVehicleImage()` called
`sharp(...).metadata()`, `.resize()`, and `.toBuffer()` with no timeout anywhere in the
chain. Sharp/libvips has no built-in one. Nothing in this test proved that combination
can hang — the 245MB matched-fixture run (5.15) shows Sharp actually fails fast
(~100ms/image) on random bytes when reached directly — but "fails fast on the inputs
tested so far" is not the same claim as "cannot hang on any malformed input," and a
single dealer upload with a genuinely pathological file (a zip bomb disguised as a
JPEG, a crafted file triggering a slow libvips code path) was never ruled out by this
testing. The fix costs little and the failure mode it guards against — one bad photo
silently blocking an entire upload job forever, exactly Incident 5.14's stuck-job
pattern but from an application cause instead of an operational one — is worth closing
pre-emptively.

**What was added:** each `sharp()` call in `processVehicleImage()` is now wrapped in a
`Promise.race` against a new `IMAGE_PROCESSING_TIMEOUT_MS` env var (default 15s,
`.env`, same pattern as `NOTIFICATION_TIMEOUT_MS`/`SES_TIMEOUT_MS`). A timeout rejects
with an `Error` whose message includes "Image processing timed out... image..." —
worded so `process-job-images.service.ts`'s existing `isImageProcessingFailure()`
keyword match (`.includes('image')`) classifies it as an ordinary per-image failure,
routing through the same already-correct skip-and-continue path a decode error already
uses, rather than introducing a new failure category. No test in this repo currently
exercises a genuine multi-second Sharp hang to verify the timeout actually fires under
that condition (the "fails fast" result in 5.15 doesn't exercise it) — this remains
unverified in the one scenario it specifically exists for, and is worth a targeted unit
test (e.g. a `setImageProcessorForTest` double that never resolves) rather than relying
on another k6 run to reproduce a hang on demand.

### 5.17 End-to-end dealer VUs crashed: `__VU` is numbered across all scenarios

**Symptom:** after the level rework, Levels 1 and 2 logged `Cannot read property
'regPrefix' of undefined` for the dealer scenario. Level 0 passed by coincidence.

**Cause:** `dealerIngestion` picked its dealer and fixture with `__VU - 1`. k6 numbers
VUs across every scenario in the test, so dealer VUs carry ids after (or among) the
buyer VUs, and `data.dealers[__VU - 1]` read past the end of the array.

**Fix:** the dealer scenario now uses `shared-iterations` with `iterations == vus`, and
each dealer takes its index from `exec.scenario.iterationInTest`, which is unique and
starts at 0 within the scenario.

### 5.18 Three buyers driven by two VUs each: a false 1% failure rate, and a real race

**Symptom:** Level 1 failed its `http_req_failed < 1%` threshold (1.01%) with all
failures on `save_favourite`: HTTP 500 (`QueryFailedError`) and 409 ("already in
favourites"). Postgres logged about 250 `duplicate key ... uq_favourites_buyer_vehicle`
errors, all for the same three buyer accounts.

**Cause (test):** the script registered exactly `NUM_BUYERS` accounts and mapped VU to
account with `(__VU - 1) % NUM_BUYERS`. Because buyer VU ids run past `NUM_BUYERS`
(the dealer VUs share the id space), VUs 51-53 wrapped onto accounts 1-3, so those
three buyers had two VUs each saving and deleting the same favourite at once.

**Fix:** register `NUM_BUYERS + NUM_DEALERS` buyer accounts, one per possible VU id.
After the fix Level 1 had 0 failed requests and no duplicate-key errors.

**Real finding for the application:** `FavouritesService.addFavourite` does a
check-then-insert. Two simultaneous requests for the same buyer and vehicle both pass
the check, and the second hits the unique constraint and returns **500 instead of
409**. This needs two concurrent requests from one buyer so it is rare in practice, but
catching the unique violation and returning 409 would close it.

### 5.19 Buyer logins timed out at 200 buyers: `bcryptjs` caps login throughput

**Symptom:** the first Level 3 run printed passing thresholds, but 188 of 200 buyer
logins had timed out at k6's 60s limit, so only about 12 buyers generated traffic. The
rest looped through an early return. Its dealer jobs finished in 26s, flattering the
result.

**Cause:** auth-user-service hashes with `bcryptjs`, which is pure JavaScript and runs on
the Node event loop. A single login measured **350-500ms of main-thread CPU**, so one
process serves roughly **2-3 logins per second**. 200 buyers logging in during a 20s
ramp queue far past 60s.

**Fix (test):** buyers now log in during `setup()` and the VUs receive their tokens, so
the measured window is browse/search/favourite traffic. Tokens last 15 minutes
(`JWT_ACCESS_EXPIRES_IN`), so every level's ramp-up plus hold is kept under that.
After the change all 200 buyers were active (87,160 requests) and Level 3 produced the
valid result in §4.3.

**Real finding:** a burst of hundreds of simultaneous logins will queue on a single
auth process. On AWS each Lambda handles one request at a time, so this matters less
there, but switching to native `bcrypt` (hashing off the main thread) would raise the
per-process ceiling and stop login bursts blocking other auth requests on the same
process.

### 5.20 Out-of-memory crashes on Levels 3 and 4 were two overlapping runs

**Symptom:** Levels 3 and 4 crashed k6 with `fatal error: out of memory` /
`VirtualAlloc ... errno=1455`, with logs showing two `exit` lines and interleaved
output.

**Cause:** a first background run loop had been stopped, but it kept running its
remaining levels while a second loop started. Two k6 processes and two fixture
generators ran together, writing the same fixture folder and log files, and exhausted
memory on a 15.7GB machine that already had four services and Docker running.

**Fix:** confirmed no k6 or generator processes were running before each level, and ran
levels strictly one at a time. Level 3 then completed. Level 4 was not re-run.

**Lesson:** stopping a background shell task does not necessarily stop what it already
started; check the process list before starting the next run.

---

## 6. What these results do and do not tell us

**Do tell us:**
- The application logic, query patterns, and pipeline stages are not obviously broken
  under concurrency or volume, at the scales tested.
- The specific risk the Test Plan names — concurrent dealer ingestion degrading buyer
  search — was tested directly and not observed at 3 concurrent dealers + 50 buyers
  (Levels 1 and 2). At 200 buyers + 10 dealers (Level 3) on one laptop it was observed:
  buyer p95 rose to 0.7-1.6s with zero errors, and dealer jobs slowed from 26s to 63s.
- Ingestion scales close to linearly per row, at least to 15,000 rows.
- The system did not find a breaking point even at 8× the documented concurrent-buyer
  target, locally.
- The full dealer bulk-upload shape (CSV + real images) completes correctly at volume,
  with image processing confirmed as the dominant cost (~16× row-only processing).
- Two genuinely unexercised paths — refresh-token renewal and notification delivery —
  work correctly under real concurrency, including the idempotency race in the latter.
- One real finding on login capacity: `bcryptjs` limits one auth process to roughly 2-3
  logins per second (Incident 5.19).
- Two real boundary conditions (250MB ZIP cap, 5-connection DB pool under 8-way
  contention) were pushed past and degrade correctly (clean rejection; queuing, not
  errors) rather than failing badly.
- NL search is now confirmed to be exercising the real Groq LLM path, not silently
  running on the deterministic fallback — see Incident 5.10's retroactive caveat on
  the original §4.1 baseline.

**Do not tell us:**
- Real AWS instance sizing, RDS connection pool limits under real network latency, or
  Lambda cold-start behaviour — none of this exists in a locally-run plain Node
  process. This is the Test Plan's own stated limitation (§9.1), not an oversight here.
- Anything about Level 4 (400 buyers, 20 dealers, 600 images each): it is built but has
  not been run.
- Whether Level 3's latency would hold on separate AWS compute: it was measured with all
  services and the load generator sharing one machine.
- The actual per-job ceiling for ingestion (25MB / ~290,000 rows theoretical, 15,000
  rows actually tested).
- Behaviour under sustained (multi-hour) load — no soak test has been run.
- Behaviour under a sudden traffic spike with real autoscaling — no spike test has
  been run, and cannot be run meaningfully outside a real Lambda deployment.
- Whether the gateway's 25MB ZIP cap vs. the service's 250MB cap (Incident 5.12) is
  intentional — this needs a product/infra decision, not another test.
- Refresh-token behaviour under realistic distinct-IP concurrency — the local result
  was deliberately sized to avoid the shared-localhost-IP rate limit (Incident 5.11),
  not to test what happens at or past it.

---

## 7. Staging — scoped, not yet run

A deployed environment (CloudFront: `https://dqs2rku4g68rc.cloudfront.net/`) became
available during this work. Running the existing scripts against it needs no new code
— every script already reads its target URLs from environment variables
(`AUTH_BASE_URL`, `MARKETPLACE_BASE_URL`, `INGESTION_BASE_URL`, `ADMIN_BASE_URL`) with
local defaults, so pointing at staging is a matter of overriding those variables, not
writing a second copy of any script.

**Deliberately paused before running anything**, for one reason: every request against
a real AWS deployment has a real, metered cost (Lambda invocations, API Gateway
requests, RDS load under sustained concurrency), and neither the AWS account nor its
current budget/spend visibility belongs to this work — confirming a cost expectation
first is the responsible order of operations, not an afterthought.

### 7.1 Before running anything against staging

- **Confirm the real path routing.** The local scripts assume marketplace-service is
  reachable at a bare base URL (`http://localhost:3002/search/filters`); the deployed
  path structure behind CloudFront (likely `/marketplace/search/filters`,
  `/auth/login`, etc., matching the api-gateway's routing) needs confirming before
  pointing scripts at it — an unconfirmed path would 404 harmlessly, but it's worth
  getting right the first time rather than guessing against billed infrastructure.
- **Confirm the database is seeded.** Every baseline script needs at least one real
  vehicle row to query.
- **Confirm there's a safe time window.** Running concurrent load against shared
  staging infrastructure without coordination risks disrupting anyone else using it at
  the same time.
- **Get an explicit go-ahead from whoever owns the AWS account**, alongside the
  budget confirmation already in progress.

### 7.2 Recommended order once cleared to proceed

1. `search-filters-baseline.js` alone — 30 seconds, ~30 requests, the smallest
   possible real data point. Check AWS Cost Explorer afterward for the actual
   per-request cost before scaling anything up.
2. The remaining three baselines, individually.
3. `login-favourites-load.js` — 50 concurrent buyers, ~3.5 minutes.
4. `end-to-end-load.js` Level 0, then Levels 1-3 in order, then `dealer-ingestion-volume.js`.
   Staging needs `AUTH_RETURN_VERIFICATION_TOKEN` enabled (the scripts read verification
   tokens from the register response), raised per-IP rate limits, and the gateway's
   path routing and 25MB upload cap in mind (Incident 5.12).
5. `buyer-traffic-stress.js` — last, deliberately: this is the most expensive script
   (400 concurrent VUs) and the one most likely to trigger autoscaling or throttling
   behaviour worth observing specifically once the smaller runs have established a
   cost baseline.

Spike and soak scenarios are natural additions once staging access is confirmed —
staging is the first environment where either would actually be meaningful (Section 2).
