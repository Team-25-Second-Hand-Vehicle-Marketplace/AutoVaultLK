# AutoVaultLK - Service Architecture Reports

Written from the source as of 2026-09-28 (branch `main`). Each report covers one
service: its structure module by module, the reasoning behind the notable decisions,
and the end-to-end flows through it.

| # | Report | Covers |
|---|---|---|
| 01 | [marketplace-service](01-marketplace-service.md) | Buyer catalogue, search (filter + natural-language), listing lifecycle, favourites, recommendations, images |
| 02 | [ingestion-service](02-ingestion-service.md) | Bulk upload API, the 11-stage ETL pipeline, dual local/Step-Functions orchestration, job status |
| 03 | [web-frontend](03-web-frontend.md) | React SPA for buyers, dealers and admins; gateway contract, auth, search state, dealer review UI |
| 04 | [load-testing](04-load-testing.md) | k6 baselines, load, volume and stress testing against the local stack; every incident and root cause; staging scope (not yet run) |

Not covered here: `auth-user-service`, `admin-service`, `notification-service`,
`api-gateway`, `database`, `cloud-infrastructure`.

---

## The platform in one picture

```
                         ┌──────────────────────┐
                         │     web-frontend     │  React SPA (report 03)
                         └──────────┬───────────┘
                                    │
                    nginx / API Gateway - one path space
     ┌──────────────┬───────────────┼───────────────┬──────────────┐
     │              │               │               │              │
 /auth /users   /marketplace    /ingest /jobs     /admin       (static)
 /dealer-       (prefix          (prefix         (prefix
  profiles       STRIPPED)       preserved)      preserved)
     │              │               │               │
     ▼              ▼               ▼               ▼
auth-user-    marketplace-     ingestion-      admin-service
  service       service          service
   :3001         :3002            :3003           :3004
     │              │               │
     │              ▼               │
     │      ┌───────────────┐       │
     └─────▶│   Postgres    │◀──────┘
            │  + pgvector   │
            └───────────────┘
              auth.*        owned by auth-user-service
              marketplace.* owned by marketplace-service
              ingestion.*   owned by ingestion-service
```

### Schema access rules (ADR-002, `plan-b-reads-cross-schemas.md`)

- Each service **owns** one schema and writes only there - with exactly one exception.
- **The exception:** `ingestion_service_role` holds SELECT/INSERT/UPDATE (never
  DELETE) on `marketplace.vehicles` and `marketplace.vehicle_images`, confined to a
  single class, `MarketplaceVehiclesWriteAdapter`. Report 02 §6.10.
- **Cross-schema reads are permitted** and used: marketplace reads `auth.users` and
  `auth.dealer_profiles` through view-entities; ingestion reads both plus
  `marketplace.vehicle_dictionaries`.

---

## The two invariants that span services

**1. Embedding parity (FR-22.1 / NFR-26.1).** `shared/normalize-embed/` is duplicated
**byte-for-byte** in marketplace-service and ingestion-service. A manually created
listing and a bulk-uploaded one must land in the same 384-dimension vector space.
Divergence produces no error, no failing test and no log line - just permanently
badly-ranked listings. Guarded by a byte-identity parity test.

**2. Shared matching thresholds.** `TRIGRAM_THRESHOLD = 0.45` and
`AMBIGUITY_MARGIN = 0.05` are pinned independently in both services' parsers, so both
halves of the platform accept the same misspellings and refuse the same ambiguous
matches. Hand-synced, with comments in both places saying so.

---

## The listing lifecycle, end to end

```
MANUAL PATH (individual verified dealers)
  Dealer form → POST /marketplace/listings → status LIVE immediately

BULK PATH (business verified dealers)
  CSV+ZIP → POST /ingest/upload → 202
         → ETL: validate → split → normalize → groq → validate rows
                → enrich → embed → load          (‖ image processing)
         → marketplace.vehicles, status PENDING_REVIEW
         → AGGREGATE → COMPLETED | PARTIAL | FAILED → NOTIFY
  Dealer → GET /marketplace/listings/mine?sort=confidence_asc
         → reviews provenance, corrects
         → PATCH /marketplace/listings/:id/approve → LIVE

BOTH converge:
  status = 'LIVE' is the only thing any buyer-facing query will return.
```

FR-42 in one sentence: **no ETL-loaded listing becomes publicly visible until the
owning dealer explicitly approves it.**

---

## Cross-cutting notes recorded in the reports

Each report ends with an "observations" section. The items that span more than one
service:

- **`ProductionExceptionFilter` is registered in `main.ts` but not in the Lambda entry
  points** of both marketplace-service and ingestion-service - error response bodies
  differ between local and deployed environments.
- **The Step Functions ASL definition has no `PROCESS_IMAGES` state**, so the deployed
  Lambda path does not process images; only `LocalOrchestrator` does.
- **The frontend's ZIP size limit (25MB) is ten times stricter than the server's**
  (250MB).
- **`ingestion.template.ts` (frontend) is a hand-maintained mirror** of
  `csv-contract.ts` (ingestion) with nothing enforcing parity.
- **`marketplace-service/src/modules/search/README.md` is stale** in five specific
  ways - most importantly it states the natural-language pipeline is unbuilt, when it
  is fully built and wired.
