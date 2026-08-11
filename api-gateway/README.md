# API Gateway

North-south and east-west API boundaries per the Software Architecture Document (SAD sections 3.5.1 and 3.5.2).

| Environment | Implementation |
|---|---|
| **AWS (production)** | Amazon API Gateway HTTP APIs defined in Terraform (`cloud-infrastructure/terraform/`) |
| **Local development** | nginx path proxy on port **8080** (`local/nginx.conf`) |

JWT validation and RBAC run **inside each NestJS service** (SAD section 3.4.1). The gateway routes traffic only; it does not issue or verify tokens.

## CORS (single source of truth)

Browser CORS for the public API is defined once in **`config/cors.json`**. That file drives:

| Consumer | How it is applied |
|---|---|
| **Local nginx** (`local/nginx.conf`) | `npm run sync:cors` writes the `# BEGIN CORS` block |
| **OpenAPI / API Gateway import** (`openapi/public-api.yaml`) | `npm run sync:cors` updates `x-amazon-apigateway-cors` |
| **Terraform (AWS)** | `modules/api-gateway/main.tf` reads `config/cors.json` via `jsondecode(file(...))` |

After editing `config/cors.json`, run `npm run sync:cors` and `npm test` (the `cors-alignment` suite fails on drift).

NestJS services use `CORS_ORIGINS` in `.env` for direct-to-service dev traffic; keep the first origin aligned with `config/cors.json` for local development.

## Route map (public)

| Prefix | Service | Port (local) | Upstream path | Notes |
|---|---|---|---|---|
| `/auth/*` | auth-user-service | 3001 | `/auth/*` (preserved) | Register/login; JWT-protected auth actions |
| `/users/*` | auth-user-service | 3001 | `/users/*` (preserved) | User profile & account routes |
| `/dealer-profiles/*` | auth-user-service | 3001 | `/dealer-profiles/*` (preserved) | Dealer profile management |
| `/marketplace/*` | marketplace-service | 3002 | `/*` (**prefix stripped**) | Listings & marketplace dealer views |
| `/ingest/*` | ingestion-service | 3003 | `/ingest/*` (preserved) | Stub — controllers not implemented yet |
| `/jobs/*` | ingestion-service | 3003 | `/jobs/*` (preserved) | Stub — controllers not implemented yet |
| `/admin/*` | admin-service | 3004 | `/admin/*` (preserved) | Stub — controllers not implemented yet |
| `/notifications/*` | notification-service | 3005 | `/notifications/*` (preserved) | Stub — controllers not implemented yet |

### Prefix rewrite rules (`local/nginx.conf`)

Only **`/marketplace/`** strips the gateway prefix before forwarding. All other public prefixes are **preserved** on the upstream service so they match NestJS `@Controller(...)` paths.

| Client request | Forwarded to service |
|---|---|
| `POST /auth/login` | `auth-user-service:3001/auth/login` |
| `GET /users/me` | `auth-user-service:3001/users/me` |
| `GET /dealer-profiles/me` | `auth-user-service:3001/dealer-profiles/me` |
| `GET /marketplace/listings` | `marketplace-service:3002/listings` |
| `GET /marketplace/dealers/{id}/profile` | `marketplace-service:3002/dealers/{id}/profile` |
| `POST /ingest/upload` | `ingestion-service:3003/ingest/upload` |
| `GET /jobs/{jobId}` | `ingestion-service:3003/jobs/{jobId}` |
| `GET /admin/dashboard` | `admin-service:3004/admin/dashboard` |

`internal/*` routes are **not** on this public listener (see internal OpenAPI). Call services directly on their ports for east-west traffic in local dev.

## Internal routes (east-west)

Defined in `openapi/internal-api.yaml`. Admin service calls auth-user-service for dealer approve/reject and user deactivate (ADR-005). Not exposed on the public nginx listener.

Set `AUTH_SERVICE_INTERNAL_URL=http://localhost:3001` when running services on the host, or `http://auth-user-service:3001` inside Docker Compose.

## Local quick start

Run from the **repo root** (two compose files — do not confuse them):

1. Copy `.env.example` to `.env` and fill secrets.
2. Start Postgres (`docker-compose.yml`):

```powershell
docker compose up -d
```

3. Start services on their ports (3001–3005).
4. Start gateway shim (`docker-compose.dev.yml`):

```powershell
docker compose -f docker-compose.dev.yml up gateway -d
```

5. Frontend / API clients use `http://localhost:8080` as the base URL.

## OpenAPI specs

- `openapi/public-api.yaml` — browser-facing routes (import into AWS API Gateway)
- `openapi/internal-api.yaml` — service-to-service routes (private API Gateway)

## Tests

```powershell
cd api-gateway
npm ci
npm test
```

Tests validate OpenAPI structure, SAD route prefixes, public vs internal boundaries, and nginx location alignment. CI also runs `nginx -t` inside Docker with `--add-host=host.docker.internal:host-gateway` so upstream names resolve on Linux runners (same as `docker-compose.dev.yml` `extra_hosts`).

Optional live check (gateway container must be running):

```powershell
docker compose -f docker-compose.dev.yml up gateway -d
cd api-gateway
$env:RUN_GATEWAY_E2E="true"; npm test -- gateway-health
```

## AWS deployment (scaffold only)

Terraform module: `cloud-infrastructure/terraform/modules/api-gateway/`

> **Traffic does not work in AWS after `terraform apply`.** The module intentionally provisions only HTTP APIs and stages (public + internal). Routes and backend integrations are **not** created yet — invoke URLs exist but return API Gateway **404** until wired.

| What works | Where |
|---|---|
| Path proxy to NestJS services | Local nginx on port **8080** (`local/nginx.conf`) |
| Route catalogue / contract | `openapi/public-api.yaml`, `openapi/internal-api.yaml` |
| AWS resource shell + CORS | Terraform module (scaffold) |

Next steps for AWS: deploy service backends, add `aws_apigatewayv2_route` / `aws_apigatewayv2_integration` resources (see commented example in `main.tf`), or import from OpenAPI. Module README: `cloud-infrastructure/terraform/modules/api-gateway/README.md`.

`terraform validate` in CI checks HCL structure only — not live routing.
