# API Gateway

North-south and east-west API boundaries per the Software Architecture Document (SAD sections 3.5.1 and 3.5.2).

| Environment | Implementation |
|---|---|
| **AWS (production)** | Amazon API Gateway HTTP APIs defined in Terraform (`cloud-infrastructure/terraform/`) |
| **Local development** | nginx path proxy on port **8080** (`local/nginx.conf`) |

JWT validation and RBAC run **inside each NestJS service** (SAD section 3.4.1). The gateway routes traffic only; it does not issue or verify tokens.

## Route map (public)

| Prefix | Service | Port (local) | Notes |
|---|---|---|---|
| `/auth/*` | auth-user-service | 3001 | Register/login public; other routes JWT-protected in service |
| `/marketplace/*` | marketplace-service | 3002 | Browse/search public; mutations require dealer JWT |
| `/ingest/*` | ingestion-service | 3003 | Business verified dealers only (not implemented yet) |
| `/jobs/*` | ingestion-service | 3003 | Job status polling (not implemented yet) |
| `/admin/*` | admin-service | 3004 | Administrator only |
| `/notifications/*` | notification-service | 3005 | Internal/event-driven in MVP |

Gateway strips the **prefix** before forwarding. Example: `GET /marketplace/listings` → `marketplace-service:3002/listings`.

## Internal routes (east-west)

Defined in `openapi/internal-api.yaml`. Admin service calls auth-user-service for dealer approve/reject and user deactivate (ADR-005). Not exposed on the public nginx listener.

Set `AUTH_SERVICE_INTERNAL_URL=http://localhost:3001` when running services on the host, or `http://auth-user-service:3001` inside Docker Compose.

## Local quick start

1. Copy root `.env.example` to `.env` and fill secrets.
2. Start Postgres: `docker compose up -d`
3. Start services on their ports (3001–3005).
4. Start gateway shim:

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

Tests validate OpenAPI structure, SAD route prefixes, public vs internal boundaries, and nginx location alignment. CI also runs `nginx -t` inside Docker.

Optional live check (gateway container must be running):

```powershell
docker compose -f docker-compose.dev.yml up gateway -d
cd api-gateway
$env:RUN_GATEWAY_E2E="true"; npm test -- gateway-health
```

## AWS deployment

Terraform module: `cloud-infrastructure/terraform/modules/api-gateway/`

Wire Lambda ARNs per service when handlers are ready. Until then, `terraform validate` checks structure only.
