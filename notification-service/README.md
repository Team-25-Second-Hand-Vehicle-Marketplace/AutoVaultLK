# Notification Service

Sends outcome e-mails for AutoVault LK, such as upload results and dealer decisions. Runs on port **3005**.

## Responsibilities

- Accept notification events from other services over an internal route, or from the SQS queue.
- Render each event into an e-mail from its template.
- Send through SMTP when `SMTP_HOST` is set, otherwise through Amazon SES.
- Retry transient failures in the background, in batches, and stop after the maximum number of attempts.

## Routes

| Route | Purpose |
|---|---|
| `POST /notifications/events` | Accepts one event. Requires the `X-Internal-Service-Key` header. |
| `GET /health` | Liveness check |

Supported event types: `UPLOAD_COMPLETED`, `UPLOAD_FAILED`, `DEALER_VERIFIED` and `DEALER_REJECTED`.

A transient send failure leaves the notification pending, and the retry sweeper picks it up on its next run.

## Configuration

Copy `.env.example` to `.env` and fill in the values. The file lists every variable with a safe default.

| Group | Variables |
|---|---|
| Service | `NODE_ENV`, `NOTIFICATION_PORT`, `NOTIFICATION_DATABASE_URL`, `DATABASE_SSL`, `CORS_ORIGINS`, `DISABLE_VERBOSE_ERRORS`, `INTERNAL_SERVICE_KEY` |
| SMTP (used when set) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| Amazon SES | `SES_FROM_EMAIL`, `SES_TIMEOUT_MS`, `AWS_REGION`, `AWS_SQS_ENDPOINT` |
| Retry | `NOTIFICATION_RETRY_ENABLED`, `NOTIFICATION_RETRY_INTERVAL_MS`, `NOTIFICATION_RETRY_BATCH_SIZE` |

Keep `SMTP_PASS` in the git-ignored `.env`. Never commit it.

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
│   └── notifications/  controllers, event handling, templates, adapters and retry sweeper
├── infrastructure/
│   ├── aws/sqs/        queue consumer and publisher
│   └── database/       TypeORM entities and repositories
├── config/             database configuration
├── common/             guards and exception filters
└── health/             liveness check
```
