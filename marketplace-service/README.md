# Marketplace Service

Owns vehicle listings, search, favourites, recommendations and the vehicle dictionary. Runs on port **3002**.

## Responsibilities

- Listing management: create, edit, approve (single or in bulk), deactivate, unarchive and delete.
- Listing photos, stored locally in development and in S3 in production.
- Search: structured filters, natural-language search with rule-based parsing, optional Groq repair, and embedding-based ranking.
- Favourites and recommendations.
- Facets and statistics for the public marketplace.
- Dictionary aliases, including promotion of candidates (internal).

## Routes

| Area | Routes |
|---|---|
| Listings (`/listings`) | `POST /`, `GET /`, `GET mine`, `GET :id`, `PATCH :id`, `DELETE :id`, `PATCH :id/approve`, `PATCH approve-all`, `PATCH approve-selected`, `PATCH :id/deactivate`, `PATCH :id/unarchive`, `POST :id/images`, `DELETE :id/images/:imageId` |
| Search (`/search`) | `GET filters`, `GET nl`, `GET facets`, `GET stats`, `GET options`, `GET vehicles/:id`, `POST aliases/promote` |
| Dealers (`/dealers`) | `GET :id`, `GET :id/profile`, `PUT :id/profile` |
| Favourites (`/favourites`) | `POST :vehicleId`, `GET /`, `DELETE :vehicleId` |
| Recommendations (`/recommendations`) | `GET vehicles/:vehicleId` |
| Images (`/images/local`) | `GET *key` (local development only) |
| Internal dictionary (`/internal/dictionary`) | `POST /`, `POST :id/aliases`. Guarded by the `X-Internal-Service-Key` header. |
| Health (`/health`) | Liveness check |

## Configuration

Copy `.env.example` to `.env` and fill in the values. The file lists every variable with a safe default.

| Group | Variables |
|---|---|
| Service | `NODE_ENV`, `MARKETPLACE_PORT`, `MARKETPLACE_DATABASE_URL`, `DATABASE_SSL`, `CORS_ORIGINS`, `DISABLE_VERBOSE_ERRORS`, `JWT_ALGORITHM`, `INTERNAL_SERVICE_KEY` |
| Images | `IMAGE_SERVE_MODE`, `MARKETPLACE_IMAGES_BUCKET`, `MARKETPLACE_IMAGES_LOCAL_ROOT`, `IMAGE_PRESIGN_EXPIRY_SECONDS`, `AWS_REGION` |
| Groq (optional) | `GROQ_API_KEY`, `GROQ_API_URL`, `GROQ_MODEL`, `GROQ_TIMEOUT_MS` |
| Embeddings | `EMBEDDING_DISABLED`, `EMBEDDING_MODEL_CACHE_DIR` |

Without `GROQ_API_KEY`, natural-language search uses the rule-based parser alone.

## Scripts

```bash
npm run start:dev         # run with watch mode
npm run build             # compile to dist/
npm run typecheck         # type checking without output
npm run test:ci           # unit tests
npm run test:integration  # needs the local PostgreSQL container
npm run test:e2e
```

## Structure

```text
src/
├── modules/
│   ├── listings/        listing lifecycle, approval and images
│   ├── search/          parser, Groq repair, filters, ranking and dictionary
│   ├── favourites/      buyer favourites
│   ├── recommendations/ recommended vehicles
│   ├── dealers/         dealer details for the marketplace
│   └── images/          image URL resolution and local serving
├── common/              guards and exception filters
├── config/              database and image serving configuration
├── infrastructure/      TypeORM entities and database adapters
└── shared/              normalisation and embedding helpers
```
