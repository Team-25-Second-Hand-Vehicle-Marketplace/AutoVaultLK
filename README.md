<p align="center">
  <img src="web-frontend/public/favicon.svg" width="96" alt="AutoVault LK logo" />
</p>

<h1 align="center">AutoVault LK</h1>

<p align="center">
  A second-hand vehicle marketplace for Sri Lanka, with natural-language search,<br/>
  verified dealers and bulk inventory upload.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-1b5fff" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/backend-NestJS-e0234e" alt="NestJS" />
  <img src="https://img.shields.io/badge/frontend-React-61dafb" alt="React" />
  <img src="https://img.shields.io/badge/database-PostgreSQL%2017-336791" alt="PostgreSQL 17" />
  <img src="https://img.shields.io/badge/cloud-AWS-232f3e" alt="AWS" />
</p>

---

## Overview

Buying or selling a used vehicle in Sri Lanka usually means scrolling endless
Facebook groups and guessing keywords on classifieds sites. AutoVault LK adds:

- **Natural-language search** that understands phrases like "family friendly
  vehicle" or "luxury car under 10 million", with a relaxation step when
  nothing matches.
- **Traditional filters** for buyers who prefer dropdowns.
- **Verified dealers.** Every dealer submits documents and is approved by an admin.
- **Bulk inventory upload.** Dealers upload a CSV and a ZIP of photos, which an
  ETL pipeline validates, enriches and publishes.
- **Favourites and recommendations** for buyers.
- **Email notifications** for verification, password reset and upload outcomes.

## Architecture

| Service | Responsibility | Port |
|---|---|---|
| `web-frontend` | React single-page app (Vite) | 5173 |
| `auth-user-service` | Sign-up, sign-in, Google sign-in, tokens, dealer profiles | 3001 |
| `marketplace-service` | Listings, search, favourites, recommendations | 3002 |
| `ingestion-service` | Bulk upload API, job status, ETL pipeline | 3003 |
| `admin-service` | Dealer approval, users, uploads, reports, audit logs | 3004 |
| `notification-service` | Email delivery with retries | 3005 |
| `api-gateway` | nginx shim for local routing (AWS API Gateway in production) | 8080 |
| PostgreSQL 17 + pgvector | One database, one schema per service | 5433 |

In production, each NestJS service runs as an AWS Lambda container, behind API
Gateway, with S3 for files, SQS and Step Functions for the upload pipeline, and
SES or SMTP for email.

## Prerequisites

- Node.js 22 and npm
- Docker Desktop (for PostgreSQL and the optional gateway)
- PowerShell (Windows) or a POSIX shell with `make` (macOS and Linux)

## Quick start

1. **Create your environment file.** Copy `.env.example` to `.env` at the repo
   root and fill in the values. Secrets stay in this git-ignored file.

   ```powershell
   copy .env.example .env
   ```

2. **Start the database and seed it (first time only).**

   ```powershell
   docker compose up -d
   cd database
   npm install
   npm run db:setup
   npm run seed:dictionaries
   npm run seed:vehicles
   npm run seed:admin
   cd ..
   ```

3. **Run the stack.**

   ```powershell
   .\scripts\start-all.ps1          # Postgres, every service and the frontend
   .\scripts\stop-all.ps1           # stop everything, keep the data
   ```

   Then open <http://localhost:5173>.

## Building and testing

| Task | Windows | macOS / Linux |
|---|---|---|
| Install and build everything | `.\scripts\build-all.ps1` | `scripts/build-all.sh` |
| Build without reinstalling | `.\scripts\build-all.ps1 -SkipInstall` | `scripts/build-all.sh --skip-install` |
| Install / build / test / typecheck / lint | `make install` / `make build` / `make test` / `make typecheck` / `make lint` | same |
| Run all unit tests | `.\scripts\test-all.ps1` | `scripts/test-all.sh` |
| Run every suite (needs Postgres, see below) | `.\scripts\test-all.ps1 -Integration -Contract -E2E -Security` | `scripts/test-all.sh --integration --contract --e2e --security` |
| Unit tests for one service | `npm run test:ci` inside the service | same |
| Integration / contract / API e2e tests for one service | `npm run test:integration` / `test:contract` / `test:e2e` inside the service | same |
| Browser e2e tests (Playwright) | `cd e2e; npm ci; npx playwright install; npm test` (full stack running) | same |
| Performance tests (k6) | `k6 run performance\scripts\<script>.js` | `k6 run performance/scripts/<script>.js` |

`test-all` runs every selected suite even if one fails, prints a PASS / FAIL /
SKIP table with test counts, and exits with code 1 if anything failed. By
default it runs only the unit tests of the five backend services,
`api-gateway` and `web-frontend`.

The integration, contract, API e2e and security suites need the local Postgres
container, migrated and seeded (the database steps in Quick start). The
Playwright suite and the k6 scripts need the full stack running.

## Repository layout

```text
cloud-native-marketplace-org/
├── web-frontend/             React app
├── auth-user-service/        Authentication and users
├── marketplace-service/      Listings, search, favourites, recommendations
├── ingestion-service/        Bulk upload, job status, ETL worker
├── admin-service/            Administration
├── notification-service/     Email notifications
├── api-gateway/              Local nginx gateway and OpenAPI specs
├── database/                 Migrations, grants and seed scripts
├── cloud-infrastructure/     Terraform for AWS
├── scripts/                  Start, stop and build scripts
└── performance/              Load and stress test scripts
```

## Configuration

- `.env.example` (root) lists every variable. Each service also has its own
  `.env.example` with only the variables it reads.
- Groq (LLM fallback for search) and SMTP or SES (email) are optional locally.
  Without a key, search uses the rules-based parser and emails are logged, not sent.
- Never commit `.env` or `*.auto.tfvars`. Both are git-ignored.

## Deployment

- Pushing to `main` runs the **Deploy to production** GitHub Actions workflow.
  It tests and deploys only the services whose files changed.
- Infrastructure changes are applied manually with Terraform from
  `cloud-infrastructure/terraform/environments/production`.

## Version

This is **version 1.0.0**: the first complete release covering authentication,
marketplace search, dealer verification, bulk upload, administration and
notifications.

## Team

Group 25, second-hand vehicle marketplace project.
