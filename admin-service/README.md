# Admin Service

Administrative tools for AutoVault LK: dashboard metrics, dealer verification, user management, upload monitoring, reports, audit logs and vehicle dictionary curation. Runs on port **3004**.

## Responsibilities

- Dashboard metrics and reports, including time series.
- Dealer review: view a dealer, approve or reject.
- User management: create administrators, deactivate and reactivate accounts.
- Upload monitoring: list uploads and their rejected rows.
- Audit log search.
- Dictionary curation: review unknown makes and models, add a make or alias, dismiss a candidate.

## Routes

All routes sit under `/admin`.

| Area | Routes |
|---|---|
| Dashboard and reports | `GET dashboard`, `GET reports`, `GET reports/timeseries` |
| Dealers | `GET dealers/:id`, `POST dealers/:id/approve`, `POST dealers/:id/reject` |
| Users | `GET users`, `POST users`, `POST users/:id/deactivate`, `POST users/:id/reactivate` |
| Uploads | `GET uploads`, `GET uploads/:id/rejections` |
| Audit | `GET audit-logs` |
| Dictionary | `GET dictionary-candidates`, `POST dictionary-candidates/add-make`, `POST dictionary-candidates/add-alias`, `POST dictionary-candidates/dismiss` |
| Health (`/health`) | Liveness check |

## Configuration

Copy `.env.example` to `.env` and fill in the values. The file lists every variable with a safe default.

| Group | Variables |
|---|---|
| Service | `NODE_ENV`, `ADMIN_PORT`, `ADMIN_DATABASE_URL`, `DATABASE_SSL`, `CORS_ORIGINS`, `DISABLE_VERBOSE_ERRORS`, `JWT_ALGORITHM` |
| Other services | `AUTH_INTERNAL_URL`, `AUTH_SERVICE_INTERNAL_URL`, `MARKETPLACE_INTERNAL_URL`, `NOTIFICATION_INTERNAL_URL` |
| Verification documents | `DOCUMENT_SERVE_MODE`, `VERIFICATION_DOCS_BUCKET`, `VERIFICATION_DOCS_LOCAL_ROOT`, `DOCUMENT_PRESIGN_EXPIRY_SECONDS` |
| AWS | `AWS_REGION` |

## Scripts

```bash
npm run start:dev
npm run build
npm run test:ci           # unit tests
npm run test:integration  # needs the local PostgreSQL container
npm run test:contract
npm run test:e2e
```

## Structure

```text
src/
├── modules/
│   ├── admin/   controllers, services and clients for the other services
│   └── auth/    JWT configuration and guards
├── config/      database and document serving configuration
├── common/      exception filters
└── health/      liveness check
```
