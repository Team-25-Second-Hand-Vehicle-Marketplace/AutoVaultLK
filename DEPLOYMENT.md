# AutoVaultLK — Deployment Overview

This document explains **how the system is deployed to AWS**, and walks through the real
debugging work done to get the bulk-upload pipeline working end-to-end. It's written for
someone who understands general software/cloud concepts but hasn't worked in this specific
codebase.

---

## 1. What the system looks like

AutoVaultLK is a second-hand vehicle marketplace built as **five independent backend
services** plus a **frontend**, all running on AWS with no traditional servers to manage
(a "serverless" architecture):

| Service | Responsibility |
|---|---|
| `auth-user-service` | Login, registration, JWT tokens, dealer profiles |
| `marketplace-service` | Vehicle listings — create, search, approve, archive |
| `admin-service` | Admin dashboard, user/dealer management, audit logs |
| `notification-service` | Emails (verification, upload results, etc.) |
| `ingestion-service` | Bulk CSV/ZIP upload pipeline for dealers |
| `web-frontend` | The React website itself |

Each backend service is its own independent codebase, its own database schema, its own
CI/CD pipeline, and deploys separately from the others. This means a bug fix in one service
doesn't require redeploying, retesting, or risking the other four.

---

## 2. How a request actually reaches the code

There are no EC2 servers running 24/7 waiting for traffic. Instead:

1. A browser request hits **CloudFront** (AWS's CDN) for the frontend, or **API Gateway**
   (a managed HTTP router) for any backend API call.
2. API Gateway forwards the request to an **AWS Lambda function** — a small piece of code
   that AWS runs on demand, for the duration of that one request, then shuts down.
3. Each of the five backend services is one Lambda function (or a small handful of them),
   packaged from the exact same NestJS application code that could also run as a normal
   server — Lambda just wraps it.
4. That Lambda talks to a **shared PostgreSQL database** (Amazon RDS) through **RDS Proxy**,
   a connection-pooling layer that sits between Lambda and the database (explained in
   section 5 — this matters a lot for how many requests the system can actually handle).

This is why there's no traditional "load balancer" in this system: Lambda's own scaling
(AWS runs as many copies of the function as needed, automatically) does the job a load
balancer would normally do.

---

## 3. Infrastructure as Code — Terraform

All AWS infrastructure (every Lambda function, the database, S3 buckets, networking, IAM
permissions — everything) is defined as code using **Terraform**, under
`cloud-infrastructure/terraform/`. Nothing is clicked together by hand in the AWS Console.

The production environment (`environments/production/main.tf`) wires together ~20
reusable modules, including:

- `networking` — the VPC (private network) everything else lives inside
- `database` — the RDS Postgres instance + RDS Proxy in front of it
- `frontend` — S3 (file storage) + CloudFront (CDN) for the website
- `auth_lambda`, `marketplace_lambda`, `admin_lambda`, `notification_lambda` — one module
  per backend service
- `ingest_api_lambda`, `job_status_api_lambda`, `embed_lambda`, `process_images_lambda`,
  `stage_lambda_zip`, `step_functions` — the bulk-upload pipeline (section 4)
- `api_gateway` — the HTTP router in front of all the backend Lambdas
- `github_oidc` — lets GitHub Actions deploy to AWS **without ever storing an AWS access
  key as a secret**; GitHub proves its identity to AWS directly per deployment run

Changing infrastructure means editing a `.tf` file and running `terraform plan` (preview)
then `terraform apply` (make it real) — the same discipline as a code review, but for
infrastructure.

---

## 4. CI/CD — what happens when code is pushed

Every service has its own GitHub Actions workflow (`.github/workflows/*.yml`). The
important one for production is `deploy-production.yml`, triggered on every push to
`main`:

1. A `changes` job checks **which folders actually changed** in that push (using
   `dorny/paths-filter`) — if only `web-frontend/` changed, there's no reason to redeploy
   `auth-user-service`.
2. For each service that changed: run its tests, then (only if tests pass) deploy it.
3. Deploying a Lambda means: build the code, package it as a `.zip` (or a container image
   for two specific Lambdas — see section 4.1), upload it to AWS, and point the Lambda at
   the new version.
4. Deploying the frontend means: `npm run build`, then sync the resulting files to the S3
   bucket, then invalidate the CloudFront cache so visitors see the new version
   immediately.

This means a working, tested change reaches production automatically within a few minutes
of being merged — no manual deployment step.

### 4.1 Two packaging styles for Lambdas

Most backend Lambdas are packaged as a plain `.zip` file (fast to deploy, cold-starts
quickly). Two Lambdas in the ingestion pipeline — `embed` and `process-images` — are
packaged as **Docker container images** instead, because they depend on large native
libraries (an ML embedding model, and the `sharp` image-processing library) that don't
package cleanly into a plain zip. This distinction turned out to matter a lot (section 6).

---

## 5. The bulk-upload pipeline (ingestion-service)

This is the most architecturally interesting part of the system, and where almost all of
today's debugging happened.

When a dealer uploads a CSV (plus optionally a ZIP of photos):

1. `ingest-api` (a Lambda) accepts the file, stores it in S3, creates a row in the
   `upload_jobs` database table with status `PENDING`, and drops a message onto an **SQS
   queue** (a message queue — a to-do list the rest of the pipeline reads from).
2. An **EventBridge Pipe** watches that queue and starts an **AWS Step Functions**
   execution for each message — Step Functions is a state machine: it runs a sequence of
   Lambda functions in a defined order, with automatic retries and error handling built in.
3. The pipeline runs through several stages: validate the file → split it into chunks →
   parse and normalize each row → validate the data → enrich it → generate a search
   embedding → load it into the marketplace database → (in parallel) match photos from the
   ZIP to the right vehicle by registration number → aggregate final counts → notify the
   dealer by email.
4. Every rejected row (bad data, unrecognised make/model, etc.) is recorded individually in
   a `rejected_records` table, so a dealer can see exactly which rows failed and why —
   not just a count.

This design (queue → state machine → many small Lambdas) exists so that **one bad row in a
400-row file doesn't fail the whole upload** — each stage's failures are isolated and
retried independently, and a job can end up `PARTIAL` (some rows loaded, some rejected)
instead of an all-or-nothing failure.

---

## 6. Today's debugging: getting the pipeline actually working

The ingestion pipeline existed in code but had never successfully processed a real upload
end-to-end in production. Getting a single 3-row test file through it surfaced five
separate, genuine bugs, found one at a time as each one was fixed and the next one was
uncovered underneath it:

1. **Every pipeline Lambda crashed on startup.** All ten "lightweight" pipeline Lambdas
   shared one wiring file that — regardless of which Lambda actually needed it — always
   built an image-processing helper depending on `sharp`, a library with a native
   (non-JavaScript) component. That library can't be packaged into a plain `.zip`
   correctly, so every single stage crashed immediately with *"Could not load the 'sharp'
   module."* **Fix:** only the one Lambda that actually processes images now loads that
   dependency, and it's packaged as a container image instead of a zip (matching the
   distinction in section 4.1).

2. **Database connections were rejected.** The database connection was configured with a
   safety timeout (`statement_timeout`) sent as a database-level setting. RDS Proxy
   (the connection-pooling layer from section 2) doesn't support that setting being changed
   this way and rejected every connection outright. **Fix:** switched to an equivalent
   timeout enforced by the application itself instead of by the database.

3. **Database queries found nothing.** The database ORM (TypeORM) was told to find its
   data models by scanning a folder on disk. That works for a normal build, but a Lambda
   packaged as one bundled file has no such folder at runtime — so it silently found zero
   models, and any database query failed. **Fix:** listed the data models explicitly in
   code instead of scanning for them.

4. **Jobs got mixed up with each other.** The message-queue-to-state-machine handoff
   (EventBridge Pipes) always delivers a one-item list, not a single item, to Step
   Functions — even though only one message was ever in it. The first pipeline stage
   wasn't unwrapping that list, so it received `undefined` instead of a real job ID. Worse:
   the database library silently ignored that invalid ID instead of raising an error, and
   just returned an unrelated, arbitrary job instead — meaning one dealer's upload could
   silently process a *different* dealer's job. **Fix:** the state machine now unwraps that
   list at the very first step, before anything else runs.

5. **Uploaded photos were never matched to listings.** The path to the uploaded ZIP file
   was read once by the first pipeline stage, but never passed forward to the stage that
   actually processes images — so every upload behaved as if no ZIP had been attached, even
   when one clearly was. **Fix:** that path is now carried forward through each stage's
   output, the way every other piece of per-job data already was.

Each of these was root-caused using AWS CloudWatch logs (Lambda execution logs) and AWS
Step Functions' execution history (which records exactly what input/output passed between
every stage of a run) — not guesswork.

---

## 7. Current state

- All five backend services and the frontend deploy automatically on every push to `main`.
- The bulk-upload pipeline has been fixed end-to-end for the bug classes above and verified
  against real test uploads.
- Infrastructure changes (anything in `cloud-infrastructure/terraform/`) are **not** part of
  the automatic CI/CD pipeline — those are reviewed and applied manually via
  `terraform plan` / `terraform apply`, since infrastructure changes (unlike application
  code) can affect live, shared resources like the database.
