# Ingestion Service

Accepts dealer inventory uploads (a CSV and an optional ZIP of images), tracks upload jobs, and runs the ETL pipeline that turns the files into listings for review. Runs on port **3003**.

## Responsibilities

- Issue presigned upload URLs, so the browser sends files directly to S3.
- Confirm uploads and queue the job for processing.
- Run the ETL pipeline: validate the file, split it into chunks, normalise and enrich rows, embed, load, process images, and notify.
- Track each job's status and its rejected rows.
- Use a local object store and local queue for development.

## Routes

| Area | Routes |
|---|---|
| Uploads (`/ingest`) | `POST presign`, `POST upload/:jobId/complete`, `POST upload` (direct upload), `PUT local-object/:encodedKey` (local development only) |
| Jobs (`/jobs`) | `GET mine`, `GET active`, `GET :id`, `GET :id/rejections` |
| Health (`/health`) | Liveness check |

The upload flow:

1. `POST /ingest/presign` creates a job and returns presigned URLs.
2. The browser uploads the CSV and ZIP directly to storage.
3. `POST /ingest/upload/:jobId/complete` checks the files and queues the job.

## Pipeline

The ETL pipeline runs file-level stages (validate, split) and then per-chunk stages. The chunk size defaults to 250 rows (`INGESTION_CHUNK_SIZE`), and `INGESTION_MAX_CONCURRENCY` sets how many chunks run at once. Each stage is also packaged as a Lambda by `build:lambda-zips`, and the Step Functions definition lives in `src/infrastructure/step-functions/`.

## Configuration

Copy `.env.example` to `.env` and fill in the values. The file lists every variable with a safe default.

| Group | Variables |
|---|---|
| Service | `NODE_ENV`, `INGESTION_PORT`, `INGESTION_DATABASE_URL`, `DATABASE_SSL`, `CORS_ORIGINS`, `DISABLE_VERBOSE_ERRORS`, `JWT_ALGORITHM` |
| Storage and queue | `AWS_REGION`, `INGESTION_STORAGE_DRIVER`, `INGESTION_STORAGE_ROOT`, `INGESTION_S3_BUCKET`, `INGESTION_QUEUE_DRIVER`, `INGESTION_SQS_QUEUE_URL` |
| Pipeline | `INGESTION_CHUNK_SIZE`, `INGESTION_MAX_CONCURRENCY`, `IMAGE_PROCESSING_TIMEOUT_MS` |
| Embeddings | `EMBEDDING_DISABLED`, `EMBEDDING_MODEL_CACHE_DIR` |
| Groq (optional) | `GROQ_API_KEY`, `GROQ_API_URL`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS` |
| Notifications | `INTERNAL_SERVICE_KEY`, `NOTIFICATION_INTERNAL_URL`, `NOTIFICATION_TIMEOUT_MS` |

## Scripts

```bash
npm run start:dev
npm run build
npm run build:lambda-config   # Lambda configuration for the stage functions
npm run build:lambda-zips     # zip packages for the stage functions
npm run test:ci               # unit tests
npm run test:integration
npm run test:contract
npm run test:e2e
npm run generate:vehicles     # synthetic inventory for testing
npm run generate:images       # synthetic photos for testing
```

## Structure

```text
src/
├── modules/
│   ├── ingestion/   upload requests, presigned URLs and upload jobs
│   └── job-status/  job progress and rejected rows
├── workers/
│   └── etl-worker/  ETL pipeline stages and orchestrator
├── infrastructure/  Step Functions configuration, storage and queue adapters, database
├── lambda/          Lambda entry points
└── tools/           synthetic data generators for testing
```
