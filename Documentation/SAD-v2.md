# Software Architecture Document (SAD)

**Project:** Second-Hand Vehicle Marketplace with Intelligent Search and Automated Inventory Processing  
**Organization:** AutoVault LK  
**Project ID (PID):** 11  
**Group Number:** 25  
**Mentor:** Mr. Bhanuka Siriwardhana  
**Version:** 2.0  
**Date:** 10 August 2026  

| Registration No. | Name |
|---|---|
| 230667F | Virusan T. |
| 230670H | Vishula J. |
| 230674A | R.P.M. Vithanage |

---

## Revision History

| Date | Version | Description | Author |
|---|---|---|---|
| 15/07/2026 | 0.1 | Project commenced; initial architecture scope and view model outline | Group 25 |
| 27/07/2026 | 0.5 | Draft SAD: ADRs, use-case/logical/process views, API and security sections | Group 25 |
| 09/08/2026 | 1.0 | Initial documentation release: figures inserted, glossary completed, document review | Group 25 |
| 10/08/2026 | 2.0 | **Architecture alignment:** ADR-002 rewritten to document the single cross-schema write exception (`MarketplaceVehiclesWriteAdapter`); §9 and §11 updated with Load-stage failure/retry semantics; event-driven ETL→Marketplace boundary explicitly rejected with rationale; team capacity updated (2 members, 6 weeks remaining). | Group 25 |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Architectural Representation](#2-architectural-representation)
3. [Architectural Goals and Constraints](#3-architectural-goals-and-constraints)
4. [Use-Case View](#4-use-case-view)
5. [Logical View](#5-logical-view)
6. [Process View](#6-process-view)
7. [Deployment View](#7-deployment-view)
8. [Implementation View](#8-implementation-view)
9. [Data View](#9-data-view)
10. [Size and Performance](#10-size-and-performance)
11. [Quality](#11-quality)
- [Appendix A: Requirements Traceability Matrix](#appendix-a-requirements-traceability-matrix)
- [Appendix B: Public API Route Catalogue](#appendix-b-public-api-route-catalogue)
- [Appendix C: RBAC Permission Matrix](#appendix-c-rbac-permission-matrix)

---

## 1. Introduction

### 1.1 Purpose

This Software Architecture Document (SAD) ensures that developers, testers, reviewers, and viva examiners understand the system's design and the reasoning behind every significant architectural decision. It complements the Software Requirements Specification (SRS) and is the authoritative reference for *how* the system is built, not *what* it must do.

### 1.2 Scope

This document covers the full architectural design of the Second-Hand Vehicle Marketplace platform using the 4+1 view model:

- **Use-Case View** — actors, primary flows, and use-case realizations
- **Logical View** — service decomposition, modules, and key classes
- **Process View** — runtime communication, orchestration, and state machines
- **Deployment View** — AWS topology, networking, and infrastructure
- **Implementation View** — repository layout, layering, and coding conventions
- **Data View** — persistent schema layout, isolation model, and cross-schema grants

Out of scope: detailed UI mockups, sprint planning, and line-by-line API specifications (see SRS and Appendix B).

### 1.3 Definitions, Acronyms, and Abbreviations

| Term | Definition |
|---|---|
| **ADR** | Architecture Decision Record — a documented significant design choice with context, decision, consequences, and alternatives. All ADRs in this project are recorded **inline in this SAD** (not as separate files). |
| **DLQ** | Dead-Letter Queue — Amazon SQS queue where messages are routed after repeated processing failures. Used for upload-job orchestration, **not** for the ETL Load→Marketplace database boundary. |
| **ETL** | Extract, Transform, Load — automated pipeline converting dealer CSV/JSON/ZIP uploads into validated, searchable listings. |
| **Groq** | External LLM inference provider used as a fallback normalizer for low-confidence ETL rows and unresolved natural-language search tokens. |
| **Human-in-the-loop** | Design gate requiring dealer review before AI-inferred listing data is published; ETL-loaded listings enter `pending_review` until confirmed. |
| **IAM** | AWS Identity and Access Management — least-privilege execution roles scoped per Lambda function. |
| **Lambda** | AWS Lambda — serverless compute running NestJS HTTP handlers and ETL stage functions. |
| **MarketplaceVehiclesWriteAdapter** | The **sole** application class permitted to exercise the ADR-002 cross-schema write grant into `marketplace.vehicles` and `marketplace.vehicle_images`. Uses parameterized SQL and `ON CONFLICT` upsert — not shared ORM entity imports from marketplace-service. |
| **Model-parity constraint** | Non-negotiable requirement that ingestion and search use the same normalization dictionaries and embedding model/library version (FR-22.1, NFR-26.1). |
| **pending_review** | Listing status after ETL Load; not publicly searchable until the dealer explicitly confirms (FR-43). |
| **pg_trgm** | PostgreSQL extension enabling trigram-based fuzzy text matching. |
| **RDS** | Amazon Relational Database Service — hosts the shared PostgreSQL instance with schema-per-service isolation (ADR-001). |
| **RDS Proxy** | Connection pooler between Lambda functions and RDS; bounds database connections under Step Functions Map concurrency (NFR-10). |
| **Schema-per-service** | Logical database isolation: one RDS instance, five service-owned **schemas** (each containing **multiple tables**), each with a dedicated PostgreSQL role. *Schema-per-service does not mean one table per service.* |
| **SQS** | Amazon Simple Queue Service — durably buffers upload-start messages between the Ingest API and Step Functions. |
| **Step Functions** | AWS orchestration service coordinating ETL Lambda stages per upload with declarative Retry/Catch (ADR-003). |
| **vehicle_dictionaries** | Marketplace-owned reference tables (`makes`, `models`, `aliases`) backing pg_trgm fuzzy matching; read by Ingestion via scoped SELECT grant and in-memory cache. |

### 1.4 References

1. Group 25 (PID 11), *Project Proposal — Second-Hand Vehicle Marketplace*, University of Moratuwa, 2026.
2. Group 25 (PID 11), *Feasibility Study — Second-Hand Vehicle Marketplace*, University of Moratuwa, 2026.
3. Group 25 (PID 11), *Software Requirements Specification v2.0 — Second-Hand Vehicle Marketplace*, University of Moratuwa, 2026.
4. Group 25 (PID 11), *ETL Pipeline Design: Dealer vehicle-upload ingestion (Step Functions)*, internal design document, 2026.
5. `Documentation/plan-b-reads-cross-schemas.md` — database grants implementation reference.
6. `Documentation/database-implementation-log.md` — verification log for schema isolation tests.

### 1.5 Overview

The system is a cloud-native vehicle marketplace deployed on AWS. Five backend services (Auth & User, Marketplace, Ingestion & ETL, Admin, Notification) plus a React web frontend communicate through a public API Gateway (north-south) and an internal API Gateway (east-west). Bulk inventory processing is orchestrated by AWS Step Functions with per-stage Lambda functions.

Data lives in a single Amazon RDS PostgreSQL instance (with `pgvector` and `pg_trgm` extensions), logically partitioned into five schemas with five least-privilege database roles. This document records one deliberate, narrow exception to strict write isolation at the ETL Load boundary — see ADR-002.

---

## 2. Architectural Representation

This SAD follows the **4+1 Architectural View Model** (Kruchten). Each view addresses a distinct stakeholder concern; together they describe the same system from complementary angles. Cross-references to the SRS are provided where requirements drive architectural elements.

---

## 3. Architectural Goals and Constraints

### 3.1 Architectural Goals

- **Serverless first:** All backends run on AWS Lambda within Free Tier constraints; no idle server capacity for bursty upload-driven workloads.
- **Orchestrated ETL:** AWS Step Functions with dedicated per-stage Lambdas replaces the earlier monolithic SQS-triggered `ETLWorker` design (superseded by ADR-003).
- **Hybrid intelligent search:** Combine structured filters, pgvector semantic ranking, and pg_trgm fuzzy matching with rules-first parsing and Groq LLM fallback (ADR-004).
- **Tiered dealer onboarding:** Individual vs. Business dealer types with escalating verification and capability gates (ADR-006).
- **Cross-service data isolation model:**
  - Within the shared RDS instance, each service **exclusively owns its schema** (multiple tables per schema).
  - **Reads** may cross service schemas via scoped, FK-justified, least-privilege `SELECT` grants (e.g., `marketplace_service_role` reads `auth.users` for dealer display names; `admin_service_role` reads all schemas for dashboards).
  - **Writes** are owned per service, with **exactly one** documented, database-enforced exception: the Ingestion ETL Load stage writes into `marketplace.vehicles` and `marketplace.vehicle_images` via `MarketplaceVehiclesWriteAdapter` (ADR-002). No other cross-schema `INSERT`/`UPDATE`/`DELETE` is permitted.
- **East-west service communication:** Browser-to-service traffic uses the public API Gateway. Service-to-service mutations (e.g., Admin approving a dealer) use synchronous internal HTTP through a private API Gateway / ALB (ADR-005) — never direct cross-schema writes from Admin.
- **Shared reference data for fuzzy matching:** `vehicle_dictionaries` (makes, models, aliases) are owned by marketplace-service; ingestion-service holds read-only access and caches a snapshot at container init.

### 3.2 Constraints

- **Team and timeline (updated v2.0):** Two active developers, approximately six weeks remaining (as of 10 August 2026). Architectural decisions favour a smaller number of well-justified, defensible patterns over maximally "pure" designs that cannot be implemented and tested in the available time.
- **AWS Free Tier:** Development and deployment must remain within Free Tier usage limits (NFR-31).
- **Lambda limits:** 15-minute timeout per invocation; memory tiers tuned per function (Section 10.1).
- **Groq as sole non-AWS dependency:** External API availability and rate limits affect ETL normalization and NL search fallback paths.
- **Model-parity:** Ingestion and search must share the same normalization vocabulary and embedding model version.

### 3.3 Architecture Decision Records

All ADRs are recorded inline in this section. No standalone ADR files are maintained.

#### 3.3.1 ADR-001: Shared RDS Instance with Schema-Per-Service Isolation

**Status:** Accepted  
**Date:** July 2026  
**Deciders:** Group 25

**Context:** Five backend services each own a distinct data domain. The team operates under academic timeline and AWS Free Tier budget. Fully isolated databases per service would increase cost, operational burden, and complicate cross-domain foreign keys (`marketplace.vehicles.dealer_id → auth.users.id`).

**Decision:** Use one Amazon RDS PostgreSQL instance (`pgvector`, `pg_trgm`) with five schemas (`auth`, `marketplace`, `ingestion`, `notification`, `admin`). Each service connects via a dedicated PostgreSQL role with least-privilege grants on its own schema. Cross-schema access is permitted only through explicitly defined grants (see §9).

**Consequences:**

- *Positive:* Single migration history; simpler local development; FK integrity enforceable at database level; Free Tier budget preserved; each schema may contain **multiple tables** owned by one service.
- *Negative:* Physical database coupling; splitting to per-service databases later requires connection-string changes and FK removal.
- *Mitigation:* Application code and grants enforce logical boundaries; ADR-002 documents the sole write exception explicitly.

**Alternatives considered:**

| Alternative | Reason rejected |
|---|---|
| Five separate RDS instances | Cost, ops burden, FK complexity at prototype scale |
| Single monolithic schema | No logical service boundaries |
| Shared schema, no roles | Cannot enforce isolation |

---

#### 3.3.2 ADR-002: Schema Boundaries for ETL Persistence (Cross-Schema Write Exception)

**Status:** Accepted (reaffirmed v2.0, 10 August 2026)  
**Date:** July 2026 (original); reaffirmed August 2026  
**Deciders:** Group 25

**Context:** The Ingestion & ETL pipeline processes bulk dealer uploads through AWS Step Functions with a Map state (max concurrency: 10, ~100 rows per chunk). The final **Load** stage must persist validated listings into the Marketplace domain (`marketplace.vehicles`, `marketplace.vehicle_images`).

A strict interpretation of microservice write isolation would require Marketplace-service to own all writes to its tables, implying either:
- a synchronous internal HTTP bulk-insert API per chunk, or
- an asynchronous event bus (SQS consumer + DLQ + idempotency keys) between Ingestion and Marketplace.

**Decision:**

1. **Default rule:** Each service writes only to its own schema. `ingestion_service_role` holds full CRUD on `ingestion.*`; `marketplace_service_role` holds full CRUD on `marketplace.*`; and so on.

2. **The single exception:** `ingestion_service_role` is granted `SELECT`, `INSERT`, and `UPDATE` (never `DELETE`) on `marketplace.vehicles` and `marketplace.vehicle_images` only. This grant exists solely for the ETL Load stage.

3. **Code confinement:** All exercise of this grant is confined to one class — `MarketplaceVehiclesWriteAdapter` in `ingestion-service` (`src/workers/etl-worker/pipeline/persistence/`). The adapter:
   - uses parameterized SQL (not imported marketplace ORM entities),
   - performs bulk upsert via `ON CONFLICT (upload_job_id, registration_number) DO UPDATE` (or equivalent composite unique key),
   - sets `status = 'pending_review'` on insert,
   - never issues `DELETE` against marketplace tables.

4. **Ingestion schema writes:** `loadFn` also writes to `ingestion.*` (e.g., `upload_jobs` status, `etl_stage_logs`) under normal ownership rules.

5. **Reliability layer:** Retry and failure handling for the Load write occur at the **Step Functions Task state** level (Retry/Catch), not via a separate message queue. The upsert makes Task-level retries safe (see §11.1).

**Consequences:**

- *Positive:* Preserves the ETL design's connection-pool and `MaxConcurrency: 10` sizing argument; avoids partial-success HTTP semantics and payload-size concerns of a bulk REST endpoint; no consumer lag, ordering, or duplicate-delivery problems from an intermediate queue; one clear adapter class auditable in code review.
- *Negative:* One service can mutate another service's tables — a deliberate departure from strict microservice purity; Marketplace-service must treat ETL-written rows as externally originated.
- *Mitigation:* Database grant scoped to two tables and two verbs; code confined to one adapter; idempotent upsert; `pending_review` gate before public visibility; documented inline with reopen conditions below.

**Alternatives considered:**

| Alternative | Reason rejected |
|---|---|
| **Event-driven boundary** (SQS `VehicleChunkProcessed` → Marketplace consumer + DLQ + idempotency keys) | Rejected v2.0. One producer (Load) and one consumer (`vehicles` table) with no independent scaling need. Adds failure surface (ordering, consumer lag, duplicate delivery, DLQ monitoring) without solving a real problem. Step Functions already provides retry and dead-lettering at the pipeline level. Estimated 1–1.5 weeks implementation cost unacceptable with 2 developers / 6 weeks remaining. |
| Synchronous HTTP bulk API per chunk (`POST /internal/vehicles/bulk`) | Moves connection-pool pressure to marketplace-service (shared with live search traffic); requires partial-success (207 Multi-Status) semantics and idempotency under Step Functions retries; network latency under Map concurrency. |
| Cross-schema write with no adapter discipline | Unacceptable — grant without code confinement would violate reviewability. |

**Reopen conditions (do not revisit unless both are true):**

1. The team is meaningfully ahead of schedule (core golden path working end-to-end), **and**
2. A second, genuinely independent consumer of ETL completion emerges beyond Marketplace and Notification (i.e., a real fan-out problem that an event bus would solve).

Do not reopen under time pressure or generic "microservices should be event-driven" advice without satisfying both conditions.

**Viva / interview standing answer:**

> "Five schemas, five least-privilege database roles, one shared RDS instance. Reads cross schemas only through explicitly granted, scoped SELECT permissions. Writes stay owned by each service, with exactly one narrow, database-enforced exception: the ETL pipeline's Load stage writes into Marketplace's vehicles tables under a column-scoped grant, confined in code to a single adapter class, and made safe to retry via an idempotent upsert. We evaluated an event-driven boundary and deliberately chose against it — there's a 1:1 producer-consumer relationship with no independent scaling need, so a queue would add failure surface without solving a real problem. Step Functions already gives us retry and dead-lettering at the pipeline level."

---

#### 3.3.3 ADR-003: Step Functions Orchestration over Monolithic ETL Lambda

**Status:** Accepted  
**Date:** July 2026

**Context:** The earlier single SQS-triggered `ETLWorker` Lambda hit the 15-minute timeout on large uploads and could not retry individual stages independently.

**Decision:** Orchestrate ETL as an AWS Step Functions state machine with ~11 dedicated stage Lambdas (validate, split, parse/normalize, groq fallback, validate rows, enrich, embed, load, images, aggregate, notify). Map state processes chunks with `MaxConcurrency: 10`.

**Consequences:** Per-stage retry granularity, memory-appropriate billing per function, declarative failure handling. Higher invocation count (~61 vs ~10 for a fused Lambda) accepted as deliberate trade-off.

---

#### 3.3.4 ADR-004: Rules-First Normalization with Groq LLM Fallback

**Status:** Accepted  
**Date:** July 2026

**Decision:** Parse and normalize using local dictionaries, regex rules, and pg_trgm similarity first. Invoke Groq only when confidence score falls below 0.6. Groq failures degrade to rules-only processing rather than failing the entire upload.

---

#### 3.3.5 ADR-005: Internal API Gateway for East-West Service Communication

**Status:** Accepted  
**Date:** July 2026

**Decision:** Service-to-service calls (Admin → Auth for dealer approve/reject/deactivate) use a private internal API Gateway / ALB. Admin never writes directly to `auth.*` tables. Same route definitions run locally via Docker Compose and in AWS.

---

#### 3.3.6 ADR-006: Tiered Dealer Onboarding (Individual vs. Business)

**Status:** Accepted  
**Date:** July 2026

**Decision:** Dealers register as `INDIVIDUAL` or `BUSINESS`. Business tier requires document upload and admin verification before bulk upload is enabled. Capabilities (`canBulkUpload`, `maxActiveListings`) scale by tier.

---

### 3.4 Security Architecture

#### 3.4.1 Authentication Model

JWT-based stateless authentication. Access tokens are validated locally by each service (Passport JWT strategy); the Auth service is **not** called on every protected request. Refresh tokens are hashed at rest and revocable.

#### 3.4.2 Authorization Model (RBAC)

Role-based guards at the controller level: `GUEST`, `BUYER`, `DEALER`, `ADMIN`. Bulk upload requires an approved Business-tier dealer account.

#### 3.4.3 Infrastructure Security (IAM)

Least-privilege IAM execution roles per Lambda. Notable scoping: `groqNormalize` resolves make/model against an in-memory dictionary snapshot (no live RDS connection), preserving the connection-pool argument for `loadFn`.

#### 3.4.4 Data Security

- Passwords hashed (bcrypt).
- `password_hash` excluded from cross-schema view-entities.
- Database roles enforce schema boundaries; cross-schema write exception limited to ADR-002 grant.
- Secrets in AWS Secrets Manager / SSM Parameter Store.

#### 3.4.5 External Dependency Security

Groq API key stored in Secrets Manager. Groq is invoked only from designated Lambda functions with outbound IAM permissions. No Groq credentials in client-side code.

---

### 3.5 API and Interface Architecture

#### 3.5.1 Public API Gateway (North-South)

| Route prefix | Target service | Auth | Notes |
|---|---|---|---|
| `/auth/*` | Auth & User | Mixed | Register/login public; JWT issuance |
| `/marketplace/*` | Marketplace | Mixed | Search public; listings/favourites authenticated |
| `/ingest/*` | Ingestion & ETL | Dealer (Business, verified) | Upload intake; returns `202` + Job ID |
| `/jobs/*` | Ingestion & ETL | Dealer | Job status polling (FR-32) |
| `/admin/*` | Admin | Administrator | Dashboard, users, audit |
| `/notifications/*` | Notification | Internal | Not browser-facing in MVP |

**Upload contract:** `POST /ingest/upload` → `202 Accepted` + `{ jobId }` on success; `400` with plain-language reason on format failure.

#### 3.5.2 Internal API Gateway (East-West)

| Caller | Callee | Endpoint (illustrative) | Purpose |
|---|---|---|---|
| Admin | Auth | `POST /internal/dealers/{id}/approve` | Dealer verification |
| Admin | Auth | `POST /internal/dealers/{id}/reject` | Dealer rejection |
| Admin | Auth | `POST /internal/users/{id}/deactivate` | Account deactivation |

Internal routes require Administrator JWT or service-to-service credential (mTLS or signed service token — document chosen approach at implementation).

#### 3.5.3 Asynchronous Interfaces

| From | To | Mechanism | Payload |
|---|---|---|---|
| Ingest API | Step Functions | SQS message | `{ jobId: uuid }` |
| Step Functions | ETL Lambdas | Task state invocation | S3 key references |
| ETL pipeline | Notification Service | Event (notify function / EventBridge) | Job summary counts |
| Notification Service | Amazon SES | AWS SDK | Rendered email |

**Note (v2.0):** The ETL Load stage writes **directly** to `marketplace.vehicles` via `MarketplaceVehiclesWriteAdapter` (ADR-002). There is **no** SQS queue, consumer, or DLQ between Load and Marketplace. Dealer job status uses polling (FR-32); no WebSocket in MVP.

---

### 3.6 Error Handling and Resilience

#### 3.6.1 ETL Pipeline Resilience

| Failure type | Handling | Reference |
|---|---|---|
| Groq rate limit / timeout / malformed JSON | Retry with backoff; rules-only fallback for affected rows | FR-42.1, ADR-004 |
| Row fails validation after rules + AI | Write to `ingestion.rejected_records`; continue chunk | FR-42.2 |
| Transient Lambda / network failure | Step Functions Retry with exponential backoff | FR-42, NFR-06 |
| Repeated SQS orchestration failure | Route to Dead-Letter Queue | FR-42.3 |
| Duplicate SQS delivery (job start) | Idempotent job creation keyed on upload identity | FR-41 |
| **Load write fails mid-chunk** | **Step Functions retries the Load Task state; `MarketplaceVehiclesWriteAdapter` upsert on `(upload_job_id, registration_number)` makes retry safe — no duplicate listings, no partial duplicate rows within a chunk** | **§11.1, ADR-002** |
| Entire chunk failure | Other chunks continue independently (Map state isolation) | §6.6 |

#### 3.6.2 Search Resilience

| Failure type | Handling |
|---|---|
| Groq unavailable during NL search | Rules-parsed filters only; skip semantic ranking if no semantic text |
| Query resolves entirely to structured filters | Skip vector embedding; order by price/date |
| Semantic ranking unavailable | Fall back to filter + pg_trgm search |
| Zero results after full parse | Automated relaxation before empty state |

#### 3.6.3 Notification Resilience

Notification Service retries transient SES failures without duplicate-sending. Delivery status recorded in `notification.notifications` (FR-53).

---

### 3.7 CI/CD and Environment Architecture

#### 3.7.1 Repository Structure

| Repository | Deployable unit | Primary artifact |
|---|---|---|
| `auth-user-service` | Auth Lambda(s) | Docker image → ECR |
| `marketplace-service` | Marketplace Lambda(s) | Docker image → ECR |
| `ingestion-service` | Ingest API + ETL Lambdas | Docker image(s) → ECR |
| `admin-service` | Admin Lambda(s) | Docker image → ECR |
| `notification-service` | Notification Lambda(s) | Docker image → ECR |
| `web-frontend` | React SPA | Static build → S3 + CloudFront |
| `cloud-infrastructure` | Terraform modules | AWS resources |
| `database/` | Migrations | SQL migration scripts |

#### 3.7.2 CI/CD Pipeline (GitHub Actions)

Per-service workflows: lint → unit tests → Docker build → push to ECR → deploy to target environment. Database migrations run from `database/` against the shared RDS instance.

#### 3.7.3 Environments

`dev` (local Docker Compose + optional AWS dev), `staging`, `production` — composed via Terraform environment modules.

---

### 3.8 Testing Architecture

#### 3.8.1 Testing Layers

| Layer | Scope |
|---|---|
| Unit | Services, handlers, adapters (mocked infrastructure) |
| Integration | Repository + real PostgreSQL (test schema) |
| Contract | Internal API request/response shapes |
| E2E | Upload → ETL → listing in `marketplace.vehicles` with `pending_review` |

#### 3.8.2 Architecturally Significant Test Cases

- FR-41: Reprocessing the same upload chunk does not create duplicate listings (upsert idempotency).
- FR-43: ETL-loaded listing has `status = pending_review`; excluded from public search until dealer confirms.
- ADR-002: Only `MarketplaceVehiclesWriteAdapter` issues cross-schema writes; `ingestion_service_role` `DELETE` on `marketplace.vehicles` returns permission denied.
- Load Task retry: simulate mid-chunk DB failure → Step Functions retry → row count unchanged (upsert, not duplicate insert).

#### 3.8.3 Test Data

Test containers or dedicated test schema; LocalStack for S3/SQS where feasible. Fixture CSVs in `test/fixtures/`.

---

## 4. Use-Case View

### Actors

| Actor | Description |
|---|---|
| Guest | Unauthenticated visitor; browse and search |
| Buyer | Registered user; favourites, profile |
| Dealer (Individual) | Limited listings; no bulk upload |
| Dealer (Business) | Bulk upload after admin verification |
| Administrator | User management, dealer verification, platform monitoring |
| System | ETL pipeline, Notification worker |

### 4.1 Use-Case Realizations (summary)

| ID | Use case | Primary services | Key ADR / section |
|---|---|---|---|
| 4.1.1 | Register & tiered authorization | Auth, Admin | ADR-006, §6.4 |
| 4.1.2 | Bulk upload intake | Ingestion, S3, SQS | §6.5 |
| 4.1.3 | Process and review pending listings | Ingestion (Load), Marketplace, Dealer UI | ADR-002, FR-43 |
| 4.1.4 | Hybrid natural-language search | Marketplace | ADR-004, §6.7 |
| 4.1.5 | Monitor platform activity & audit logs | Admin | §9 (admin read-only grants) |

*(Use-case diagrams: Guest, Buyer, Dealer, Administrator — see v1.0 figures; unchanged in v2.0.)*

---

## 5. Logical View

### 5.1 Overview

The architecture comprises five independently deployable backend services and one shared library layer. Each service follows the same internal package structure (`config`, `common`, `infrastructure`, `modules`, `health`, `lambda`) so team members can navigate any service consistently. Domain logic resides in application services; persistence is isolated in repositories and adapters.

### 5.2 Architecturally Significant Design Packages

#### 5.2.1 Auth & User — `auth` module

- `AuthController` — login, refresh, logout, dealer registration
- `AuthService` — credential verification, JWT issuance
- `RefreshTokenService` — hashed refresh token lifecycle
- `JwtStrategy` / `RolesGuard` — RBAC enforcement
- `DealerProfilesRepository` — tier, verification state, document references

**Owned schema tables:** `auth.users`, `auth.dealer_profiles`, `auth.refresh_tokens`

#### 5.2.2 Marketplace — `listings`, `search`, `favourites` modules

- `ListingsController` / `ListingsService` — CRUD, lifecycle, dealer review confirmation
- `SearchService` — merges filter, vector, and trigram results
- `DeterministicParser`, `PgVectorSearch`, `TrigramSearch` — search submodules
- `VehicleDictionariesRepository` — owns `makes`, `models`, `aliases`

**Owned schema tables:** `marketplace.vehicles`, `marketplace.vehicle_images`, `marketplace.favourites`, `marketplace.search_queries`, `marketplace.makes`, `marketplace.models`, `marketplace.aliases`

#### 5.2.3 Ingestion & ETL — pipeline package (`src/workers/etl-worker/pipeline/`)

| Stage directory | Handler | Responsibility |
|---|---|---|
| `normalize/` | `ParseNormalizeHandler`, `GroqNormalizeHandler` | Rules + confidence; LLM fallback |
| `validate/` | `ValidateFileHandler`, `ValidateRowsHandler` | Structural and per-row validation |
| `enrich/` | `EnrichHandler` | Derived fields, JSONB, `search_text` |
| `embeddings/` | `EmbedHandler` | MiniLM → 384-dim vector |
| `image-processing/` | `ImagesHandler` | Sharp resize; registration-number keyed matching |
| **`persistence/`** | **`MarketplaceVehiclesWriteAdapter`** | **Sole class exercising ADR-002 grant; bulk upsert into `marketplace.vehicles` and `marketplace.vehicle_images`** |

**Owned schema tables:** `ingestion.upload_jobs`, `ingestion.rejected_records`, `ingestion.etl_stage_logs`

#### 5.2.4 Admin — `users`, `uploads`, `reports`, `audit`, `dashboard` modules

- `AdminService` — orchestrates cross-service reads and internal HTTP mutations
- Read-only view-entities across `auth`, `marketplace`, `ingestion`, `notification` schemas
- All admin **mutations** go through owning service APIs (ADR-005)

**Owned schema tables:** `admin.audit_logs`

#### 5.2.5 Notification — `notifications` module

- Event-driven SES email dispatch
- `SesAdapter` — infrastructure isolation

**Owned schema tables:** `notification.notifications`

#### 5.2.6 Shared normalize + embed library

Dictionaries, regex rules, and MiniLM embedding wrapper consumed by both `marketplace-service` (query-side) and `ingestion-service` (listing-side) per model-parity constraint.

---

## 6. Process View

### 6.1 Process Organisation and Communication

| Interaction | Pattern | Example |
|---|---|---|
| Browser → Service | Sync HTTP via public API Gateway | Buyer search |
| Service → Service (mutation) | Sync HTTP via internal API Gateway | Admin approves dealer |
| Ingest API → ETL | Async SQS → Step Functions | Upload job start |
| ETL Load → Marketplace DB | **Sync direct write via adapter (ADR-002)** | Bulk upsert listings |
| ETL → Notification | Async event | Upload complete email |
| Dealer → Job status | Sync HTTP polling | `GET /jobs/{id}` |

### 6.2 Bulk Inventory Upload & ETL Orchestration

1. Dealer uploads CSV/JSON (+ optional ZIP) via `POST /ingest/upload`.
2. Ingest API validates format, stores raw files in S3, creates `upload_jobs` record (`PENDING`), publishes `{ jobId }` to SQS.
3. Step Functions execution starts; stages process file → chunks → per-chunk pipeline.
4. **Load stage:** `MarketplaceVehiclesWriteAdapter` upserts validated rows into `marketplace.vehicles` / `marketplace.vehicle_images` with `status = pending_review`.
5. Aggregate stage tallies accepted/rejected; notify stage triggers email.

### 6.6 ETL Chunk Processing (Map State) Sequence

```
For each chunk (max 10 concurrent):
  parseNormalize → [groqNormalize if confidence < 0.6] → validateRows
  → enrich → embed → load (MarketplaceVehiclesWriteAdapter upsert)
  → [on Task failure: Step Functions Retry/Catch on load state]
Other chunks continue independently on single-chunk failure.
```

**No message queue between `load` and Marketplace-service.** Persistence is synchronous within the Load Lambda invocation; reliability is provided by Step Functions retry plus upsert idempotency.

### 6.7 Intelligent Search Execution Sequence

Query → DeterministicParser → [Groq fallback if needed] → filter SQL + pgvector ranking + pg_trgm → merged ranked response.

### 6.8 Dealer Account Verification State

`PENDING` → (Admin approve via internal API) → `VERIFIED` → bulk upload enabled  
`PENDING` → (Admin reject) → `REJECTED`

### 6.9 Vehicle Listing State (Row-Level Lifecycle)

`pending_review` (ETL load) → (Dealer confirms) → `live` → (Dealer deactivates) → `inactive`  
Manual listings: `draft` → `live` → `inactive`

---

## 7. Deployment View

### AWS Topology (summary)

- **VPC** with public/private subnets
- **API Gateway** (public + internal)
- **Lambda** functions per service and ETL stage (container images via ECR)
- **RDS PostgreSQL** (single instance) + **RDS Proxy**
- **S3** — `raw/` (immutable uploads), `staging/` (~7-day lifecycle for inter-stage JSON)
- **SQS** — upload job buffer (Ingest API → Step Functions only)
- **Step Functions** — ETL state machine
- **SES** — outbound email
- **CloudWatch** — logs and metrics
- **Secrets Manager / SSM** — DB credentials, Groq API key
- **IAM** — least-privilege per Lambda

### Connection pooling

RDS Proxy bounds live database connections. `MaxConcurrency: 10` on the Map state limits concurrent `loadFn` write connections. NFR-10 target: ≤ 50 simultaneous write connections under peak upload load.

---

## 8. Implementation View

### 8.1 Overview

One repository per deployable unit. Migrations live in `database/` (not per-service repos) because one physical RDS instance holds cross-schema foreign keys. Each service's TypeORM `DataSource` registers only its owned entities plus read-only view-entities for cross-schema `SELECT`.

### 8.2 Layers

| Layer | Contents |
|---|---|
| **Presentation** | NestJS controllers; Lambda handler entrypoints; DTO validation only |
| **Application** | Business logic services (e.g., `SearchService`, `AuthService`) |
| **Persistence** | Repositories, ORM entities, `MarketplaceVehiclesWriteAdapter` |
| **Infrastructure** | `S3Adapter`, `SqsAdapter`, `SesAdapter`, `StepFunctionsAdapter`, `GroqClientAdapter` |
| **Shared/Common** | Guards, decorators, shared normalize+embed library |

**Rule:** Controllers and handlers stay thin. AWS SDK usage never appears in application services.

---

## 9. Data View

### 9.1 Physical layout

| Store | Contents |
|---|---|
| **Amazon RDS PostgreSQL** | All relational data (five schemas) |
| **S3 `raw/`** | Original dealer uploads (immutable) |
| **S3 `staging/`** | Per-stage intermediate JSON (~7-day expiry) |

Extensions: `vector` (384-dim embeddings), `pg_trgm` (fuzzy matching).

### 9.2 Schema-per-service ownership (multiple tables per schema)

| Schema | Owner service | Tables |
|---|---|---|
| `auth` | auth-user-service | `users`, `dealer_profiles`, `refresh_tokens` |
| `marketplace` | marketplace-service | `vehicles`, `vehicle_images`, `favourites`, `search_queries`, `makes`, `models`, `aliases` |
| `ingestion` | ingestion-service | `upload_jobs`, `rejected_records`, `etl_stage_logs` |
| `notification` | notification-service | `notifications` |
| `admin` | admin-service | `audit_logs` |

### 9.3 Cross-schema grant model

**Reads** — permitted only where a foreign key already links the tables:

| Consumer role | Grant | FK justification |
|---|---|---|
| `marketplace_service_role` | `SELECT` on `auth.users`, `auth.dealer_profiles` | `vehicles.dealer_id → users.id` |
| `ingestion_service_role` | `SELECT` on `auth.users` | `upload_jobs.dealer_id → users.id` |
| `ingestion_service_role` | `SELECT` on `marketplace.makes`, `models`, `aliases` | Reference data for normalization (read-only) |
| `notification_service_role` | `SELECT` on `auth.users` | `notifications.user_id → users.id` |
| `marketplace_service_role` | `SELECT` on `ingestion.upload_jobs` | Dealer upload status display |
| `admin_service_role` | `SELECT` on all non-admin schemas | Dashboard reporting (read-only) |

**Writes** — default rule: each role has full CRUD on its own schema only.

**The single write exception (ADR-002):**

```sql
-- EXCEPTION: ETL Load stage only. INSERT + UPDATE, never DELETE.
GRANT USAGE ON SCHEMA marketplace TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicles        TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicle_images TO ingestion_service_role;
```

Exercised exclusively by `MarketplaceVehiclesWriteAdapter`.

### 9.4 Load-stage failure and retry semantics

If the Load stage fails mid-chunk (transient DB error, Lambda timeout, connection pool exhaustion):

1. **Step Functions** catches the Task failure and applies the configured Retry policy (exponential backoff) on the Load state.
2. **`MarketplaceVehiclesWriteAdapter`** uses an idempotent upsert keyed on `(upload_job_id, registration_number)` via `ON CONFLICT … DO UPDATE`. Re-executing the same chunk does not create duplicate listings.
3. Rows successfully upserted before the failure remain correct; the retry completes or updates remaining rows in the chunk.
4. No separate SQS consumer, DLQ, or idempotency-key table is required for this boundary — Step Functions retry plus SQL upsert is the reliability mechanism.
5. If all Load retries are exhausted, the chunk is marked failed in `etl_stage_logs`; other Map branches continue independently.

**Action item (implementation verification):** Confirm upsert key `(upload_job_id, registration_number)` remains valid after any schema migration. Partial unique index on `registration_number` (where not null) prevents duplicate registrations across jobs.

### 9.5 Cross-schema foreign keys

Six FKs reference `auth.users.id` (from `vehicles`, `upload_jobs`, `favourites`, `search_queries`, `notifications`, `audit_logs`). Within-schema FKs (`vehicle_images → vehicles`, `refresh_tokens → users`, `rejected_records → upload_jobs`) cascade as defined in migrations.

---

## 10. Size and Performance

### 10.1 Lambda memory allocation (representative)

| Service / Stage | Lambda | Memory | Notes |
|---|---|---|---|
| Auth | `auth-api` | 256–512 MB | CRUD, JWT |
| Marketplace | `marketplace-api` | 256–512 MB | Listings, favourites |
| Marketplace | `search-api` | ~3008 MB | NL parser, Groq, MiniLM, pgvector |
| Ingestion | `ingest-upload-api` | 512 MB | Multipart upload |
| Ingestion | `job-status-api` | 256 MB | Polling |
| ETL | `load` function | 512 MB | Bulk upsert via WriteAdapter |
| ETL | `embed` function | ~3008 MB | MiniLM inference |
| ETL | `images` function | ~2048 MB | Sharp processing |
| Admin | `admin-api` | 256–512 MB | Dashboards |
| Notification | `notification-worker` | 256 MB | SES dispatch |

A 1,000-row upload at 100 rows/chunk produces ~61 Lambda invocations per Step Functions execution.

### 10.2 Performance targets

- API response: < 500 ms (CRUD/browse); < 2 s (NL search)
- Capacity: 10,000 listings, 100 concurrent users (prototype scale)
- Graceful search fallback to filter/trigram if semantic ranking degrades

---

## 11. Quality

### 11.1 Reliability

- **ETL Groq degradation:** Step Functions Retry/Catch on the Groq step; ~95% success on rules-only during outage.
- **Row-level idempotency:** Upsert on `(upload_job_id, registration_number)` in `MarketplaceVehiclesWriteAdapter` prevents duplicate listings on Step Functions Task retry or duplicate SQS job-start delivery.
- **Load mid-chunk failure (explicit):** If the Load write fails partway through a chunk, Step Functions retries the Load Task state. The upsert semantics make that retry safe: already-persisted rows are updated in place, not duplicated. This is the sole reliability layer for the ETL→Marketplace persistence boundary — a second queue-based retry/DLQ layer would duplicate Step Functions' responsibility without adding independent scaling benefit (ADR-002).
- **Orchestration DLQ:** Upload-start SQS messages route to DLQ after repeated failures (FR-42.3). This applies to job **initiation**, not to the Load→Marketplace write path.

### 11.2 Security

JWT + RBAC; least-privilege IAM per Lambda; database role isolation with one documented write exception; secrets in Secrets Manager.

### 11.3 Scalability

Map state per-chunk fan-out; Lambda auto-scaling; fixed rows-per-chunk (not chunk count) for predictable scaling.

### 11.4 Maintainability

Shared normalize+embed library prevents vocabulary drift. Per-service schema ownership keeps logical boundaries clear within one physical database.

### 11.5 Extensibility

JSONB `specs` column allows new vehicle types without schema migration. Unmapped CSV columns preserved as searchable extras.

### 11.6 Observability

`etl_stage_logs` records per-stage status, retry count, and error message. Step Functions execution graph in AWS Console.

### 11.7 Requirements Traceability Summary

| SRS ID | Requirement summary | SAD element |
|---|---|---|
| FR-02, FR-02.1 | Tiered dealer registration | ADR-006; §4.1.1 |
| FR-14 | ETL bulk insert into marketplace | **ADR-002; `MarketplaceVehiclesWriteAdapter`; §6.6, §9.4** |
| FR-21–FR-24 | Hybrid NL search | ADR-004; §6.7 |
| FR-26–FR-43 | Bulk ETL pipeline | ADR-002, ADR-003; §6.2, §6.6 |
| FR-43 | pending_review gate | §6.9 |
| FR-44–FR-49 | Admin dashboard | §5.2.4; admin read-only grants §9.3 |
| FR-50–FR-54 | Notifications | §5.2.5; §3.5.3 |
| NFR-10 | RDS Proxy for concurrency | §7 |
| NFR-26.1 | Shared normalize+embed library | §5.2.6 |

---

## Appendix A: Requirements Traceability Matrix (abbreviated)

| SRS ID | Requirement | SAD section / component | Test reference |
|---|---|---|---|
| FR-14 | ETL bulk insert | ADR-002; `load` function; `MarketplaceVehiclesWriteAdapter` | §3.8.2 upsert idempotency test |
| FR-41 | Idempotent processing | §9.4; `ON CONFLICT` upsert | Integration |
| FR-42 | ETL retry | §3.6.1; Step Functions Retry/Catch | E2E |
| FR-43 | pending_review default | §6.9 | Unit + E2E |
| ADR-002 test | Cross-schema DELETE denied | §9.3 grants | `psql` as `ingestion_service_role` |

*(Full matrix: see v1.0 Appendix A; FR-14 mapping updated in v2.0.)*

---

## Appendix B: Public API Route Catalogue (Illustrative)

### Marketplace Service
- `GET /marketplace/vehicles` — search/list
- `GET /marketplace/vehicles/:id` — detail
- `POST /marketplace/vehicles` — create (dealer)
- `PATCH /marketplace/vehicles/:id` — update
- `POST /marketplace/vehicles/:id/confirm` — dealer confirms pending_review listing
- `GET /marketplace/favourites` — buyer favourites

### Ingestion & ETL Service
- `POST /ingest/upload` — bulk upload intake
- `GET /jobs/:jobId` — upload job status

### Admin Service
- `GET /admin/users` — list users
- `POST /admin/dealers/:id/approve` — triggers internal Auth API call
- `GET /admin/audit-logs` — audit trail

*(Full catalogue: see v1.0 Appendix B.)*

---

## Appendix C: RBAC Permission Matrix

| Action | Guest | Buyer | Dealer (Individual) | Dealer (Business, verified) | Admin |
|---|---|---|---|---|---|
| Browse/search listings | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage favourites | | ✓ | ✓ | ✓ | |
| Create manual listing | | | ✓ | ✓ | |
| Bulk upload | | | | ✓ | |
| Confirm pending_review listings | | | ✓ | ✓ | |
| Verify dealers | | | | | ✓ |
| View audit logs | | | | | ✓ |

---

*Confidential © AutoVault LK, 2026*
