# Cloud-Native Marketplace Platform

This directory contains the structure for a TypeScript/NestJS vehicle marketplace platform. It is intentionally scaffold-only: application source files are not included yet.

Each service is designed to become an independent GitHub repository.

```text
cloud-native-marketplace-org/
├── auth-user-service/
├── marketplace-service/
├── ingestion-service/
├── admin-service/
├── notification-service/
├── cloud-infrastructure/
├── web-frontend/
└── README.md
```

The existing frontend is also available at `vehicle-marketplace/frontend/` and can later become the `web-frontend` repository.

## Standard NestJS service structure

```text
service/
├── src/
│   ├── config/                 Environment and application configuration
│   ├── common/                 Shared guards, filters, middleware, pipes, types
│   ├── infrastructure/         Database and AWS adapters
│   ├── modules/                Domain modules
│   │   └── feature/
│   │       ├── controllers/    HTTP or event entrypoints
│   │       ├── services/       Application and business use cases
│   │       ├── repositories/   Persistence abstractions
│   │       ├── entities/       ORM entities
│   │       └── dto/             Request, response, and message contracts
│   ├── health/                 Health and readiness structure
│   └── lambda/                 Lambda handler entrypoint structure
├── test/
│   ├── unit/
│   ├── integration/
│   ├── e2e/                    End-to-end test structure
│   ├── contract/               Event and API contract structure
│   └── fixtures/
├── docker/
├── Dockerfile
└── .dockerignore
```

The architecture keeps controllers and handlers thin. Business decisions belong in services, database access belongs in repositories, and AWS SDK usage belongs in infrastructure adapters.

## Auth & User Service

Repository: `auth-user-service`

Domain modules:

- `auth`: registration, login, JWT authentication, refresh tokens, password policies, and roles.
- `users`: user profiles and account lifecycle.
- `dealers`: dealer profiles, approval state, and dealer-specific data.

The service contains a Lambda entrypoint structure at `src/lambda/`. The root Dockerfile is prepared for a container-based Lambda deployment.

## Marketplace Service

Repository: `marketplace-service`

Domain modules:

- `listings`: vehicle listings and listing lifecycle.
- `favourites`: user favourites.
- `dealers`: marketplace-facing dealer information.
- `search`: traditional filters, natural-language search, deterministic parsing, pgvector search, and trigram search.
- `recommendations`: recommendation use cases and ranking.

Search-specific structure:

```text
src/modules/search/
├── filters/
├── natural-language/
├── deterministic-parser/
├── pgvector/
└── trigram/
```

## Ingestion & ETL Service

Repository: `ingestion-service`

This service contains three separately deployable Lambda entrypoint structures:

```text
src/lambda/
├── ingest-api/
├── job-status-api/
└── etl-worker/
```

### Ingest API

The `ingestion` module owns upload requests, S3 object references, upload jobs, CSV/JSON metadata, chunk creation, and SQS publishing.

### Job Status API

The `job-status` module owns dealer polling, upload progress, batch progress, validation errors, and processing statistics.

### ETL Worker

The SQS-triggered worker is structured as independent pipeline stages:

```text
src/workers/etl-worker/
├── handler/
├── processors/
├── pipeline/
│   ├── normalize/
│   ├── validate/
│   ├── enrich/
│   ├── embeddings/
│   ├── image-processing/
│   └── persistence/
└── infrastructure/
```

Responsibilities include normalization, validation, enrichment, metadata extraction, image processing, HuggingFace embedding generation, PostgreSQL/pgvector persistence, status updates, retries, idempotency, and dead-letter handling.

The repository also contains dedicated Dockerfiles:

```text
docker/
├── ingest-api.Dockerfile
├── job-status-api.Dockerfile
└── etl-worker.Dockerfile
```

`etl-worker.Dockerfile` is expected to contain the largest dependency set because it may include HuggingFace, TensorFlow or ONNX runtime, image-processing libraries, and data-processing libraries.

## Admin Service

Repository: `admin-service`

Domain modules:

- `users`: administrative user management.
- `uploads`: upload monitoring.
- `reports`: report generation structure.
- `audit`: audit logs and compliance records.
- `dashboard`: administrative dashboard queries.

## Notification Service

Repository: `notification-service`

The `notifications` module owns event handlers, notification use cases, SES integration, delivery records, and email templates.

Expected domain events include upload completion and upload failure events.

## Infrastructure structure

Repository: `cloud-infrastructure`

```text
cloud-infrastructure/
├── terraform/
│   ├── environments/
│   │   ├── dev/
│   │   ├── staging/
│   │   └── production/
│   ├── modules/
│   │   ├── networking/
│   │   ├── database/
│   │   ├── lambda/
│   │   ├── api_gateway/
│   │   ├── s3/
│   │   ├── sqs/
│   │   ├── ses/
│   │   ├── iam/
│   │   ├── monitoring/
│   │   └── secrets/
│   └── schemas/event_schemas/
├── policies/
├── scripts/
└── docs/
```

Terraform provisions AWS resources. It does not contain NestJS application code. Service repositories own application migrations and deployment packaging; infrastructure owns AWS resources, IAM, queues, buckets, ECR repositories, Lambda configuration, and environment composition.

## Docker deployment

Each NestJS service has a multi-stage root Dockerfile. The first stage builds the TypeScript application, and the final stage uses the AWS Lambda Node.js 22 base image.

The container entrypoint is selected with the Lambda handler configured in the Dockerfile. The ingestion service has separate Dockerfiles because its three Lambda functions are independently deployed.

Use a separate ECR image and Lambda function for each independently deployed handler. Keep the ETL worker image separate from the HTTP API images so its larger dependencies do not increase API cold starts.

## Git placeholders

`.gitkeep` files are included in empty planned directories so the structure remains visible when pushed to GitHub. They can be removed when real files are added.

## Planned GitHub organization

```text
your-organization/
├── web-frontend
├── auth-user-service
├── marketplace-service
├── ingestion-service
├── admin-service
├── notification-service
└── cloud-infrastructure
```
