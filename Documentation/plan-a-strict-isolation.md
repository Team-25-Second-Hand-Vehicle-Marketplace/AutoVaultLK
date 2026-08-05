# Plan A — Strict Isolation

> **Model:** Schema-per-service. No service reads or writes another service's
> tables. Every cross-service data access is a REST call.
>
> **Companion:** [Plan B — Reads Cross Schemas](./plan-b-reads-cross-schemas.md).
> Open questions behind both: [database-open-questions.md](./database-open-questions.md).

---

## 1. The idea in one paragraph

One PostgreSQL database, five schemas, five roles. Each role can touch exactly
one schema — its own. A service that needs another service's data asks for it
over HTTP; it cannot reach across in SQL, because PostgreSQL will refuse. The
shared database is an operational convenience (one container, one backup, one
pgvector install), not a shared data space. The boundary is enforced by the
database engine, not by developer discipline.

**The governing principle:** *the schema is private; the API is the contract.*

---

## 2. Schema and ownership map

| Schema | Owner | Tables |
|---|---|---|
| `auth` | auth-user-service | `users`, `dealer_profiles`, `refresh_tokens` |
| `marketplace` | marketplace-service | `vehicles`, `vehicle_images`, `favourites`, `search_queries` |
| `ingestion` | ingestion-service | `upload_jobs`, `rejected_records`, `etl_stage_logs` |
| `notification` | notification-service | `notifications` |
| `admin` | admin-service | `audit_logs` |

Ownership is total: whoever owns a schema owns its migrations, its entity
classes, and the API that exposes its data.

---

## 3. What the grants look like

```sql
-- Repeated per service, shown for marketplace.
GRANT USAGE ON SCHEMA marketplace TO marketplace_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA marketplace TO marketplace_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_service_role;

-- ─── No cross-schema grants exist. ───
-- Any GRANT crossing a schema boundary is a violation of this plan.
```

That absence is the entire design. There is nothing else to it.

**Consequence to internalise:** `SELECT count(*) FROM auth.users` executed as
`marketplace_service_role` fails with `permission denied for schema auth`.
That error is the plan working, not a misconfiguration.

---

## 4. Cross-schema foreign keys

Six FKs point at `auth.users.id`: from `vehicles`, `upload_jobs`,
`favourites`, `search_queries`, `notifications`, `audit_logs`.

Two positions:

### 4a. Keep the FK constraints
PostgreSQL enforces referential integrity; grants deny access. Integrity and
visibility are separate mechanisms, so in principle both can hold at once.

> **⚠ Unverified.** Whether a role with *no* privilege on `auth` can insert a
> row whose FK references `auth.users` has not been tested. FK validation runs
> as the system rather than the inserting user, so this *should* work — but
> if it does not, this plan requires 4b. **Test before building on it:**
> ```sql
> -- as marketplace_service_role, with a valid dealer_id
> INSERT INTO marketplace.vehicles (dealer_id, make, model, manufacture_year, price, mileage)
> VALUES ('<real-uuid>', 'Toyota', 'Corolla', 2018, 8500000, 45000);
> ```
> A permission error here means 4a is impossible.

### 4b. Drop cross-schema FKs, add an integrity checker
`dealer_id` becomes a plain `uuid`. Within-schema FKs all remain
(`vehicle_images → vehicles`, `refresh_tokens → users`, `rejected_records →
upload_jobs`, and so on), so cascade deletes still work where they matter.

A periodic script reports orphans:

```sql
SELECT v.id, v.dealer_id
FROM marketplace.vehicles v
LEFT JOIN auth.users u ON u.id = v.dealer_id
WHERE u.id IS NULL;
```

Run as the superuser (the only role that can see both schemas).

**Recommendation:** attempt 4a; fall back to 4b if the test fails. 4b is also
the honest choice if you intend to split into separate databases later —
a cross-schema FK is a coupling that a database split cannot carry.

---

## 5. The REST layer this plan requires

This is the work that distinguishes Plan A from Plan B. It is not optional
and it is not small.

### 5.1 Clients to build

| Consumer | Client | Needs |
|---|---|---|
| marketplace-service | `AuthClient` | dealer name/email for listing pages; dealer capabilities for the listing cap |
| ingestion-service | `AuthClient` | verify dealer may bulk upload |
| ingestion-service | `MarketplaceClient` | **write vehicles** — see §6 |
| notification-service | `AuthClient` | resolve recipient email |
| admin-service | all four | every dashboard read and every moderation write |

### 5.2 Interface shape

```ts
export interface UserSummary {
  id: string; name: string; email: string; isActive: boolean;
}

export interface DealerCapabilities {
  userId: string;
  dealerType: 'INDIVIDUAL' | 'BUSINESS' | null;
  isVerified: 'PENDING' | 'VERIFIED' | 'REJECTED';
  canBulkUpload: boolean;
  maxActiveListings: number | null;   // null = unlimited
}

export interface AuthClient {
  getUser(userId: string): Promise<UserSummary | null>;

  /** Batch form. A listing page resolves many dealers at once.
   *  Calling getUser in a loop is the N+1 trap this exists to prevent. */
  getUsers(userIds: string[]): Promise<Map<string, UserSummary>>;

  getDealerCapabilities(userId: string): Promise<DealerCapabilities>;
}
```

Transport stays behind the interface: HTTP to `localhost:300X` in
development, most likely direct Lambda invoke on AWS (east-west traffic should
not traverse API Gateway — that is north-south infrastructure).

### 5.3 What each client must handle

Every call is a network call, so each needs timeouts, retry with backoff,
a circuit breaker or equivalent, structured logging, and a test double. None
of that exists today.

---

## 6. The ETL write path — the hard part

The ETL design has `loadFn` bulk-inserting ~100 rows per chunk directly into
`marketplace.vehicles`, with `MaxConcurrency: 10` on the Step Functions Map
state. The design **explicitly justifies that concurrency limit** as
protection for the RDS connection pool, stating `loadFn` is the only stage
holding a write connection.

Under Plan A that write is illegal. It becomes:

```
POST /internal/vehicles/bulk
Body: { uploadJobId, chunkId, vehicles: [ ... ~100 rows ... ] }
→ 207 Multi-Status
  { inserted: 98, failed: [ { rowNumber: 12, reason: "..." } ] }
```

Three requirements that are easy to miss:

**Partial success must be expressible.** If 2 of 100 rows fail, the other 98
must still land. A 400 for the whole batch would discard good rows and
contradict the ETL design's rejected-records model.

**Idempotency is mandatory.** Step Functions retries on failure. Without an
idempotency key (`uploadJobId + chunkId`) or an upsert on
`registration_number`, a retry creates 100 duplicate listings.

**Payload size.** ~100 vehicles carrying `search_text` and 384-dim embeddings
is roughly 500 KB. Within Lambda (6 MB) and API Gateway (10 MB) limits, but
worth measuring rather than assuming.

### 6.1 The documentation conflict

`MaxConcurrency: 10` was chosen to protect the connection pool that `loadFn`
was holding. Under Plan A, `loadFn` holds an HTTP connection instead, and the
pool pressure moves to marketplace-service — where it is now driven by *both*
ETL traffic and live buyer traffic on the same pool.

**The ETL design's §14–15 concurrency argument does not survive this plan and
must be rewritten.** The new question is how many concurrent bulk-insert
requests marketplace-service can absorb without degrading search latency.

---

## 7. Admin service — the unavoidable exception

Admin dashboards are inherently cross-cutting: counts of users, listings,
upload jobs, and delivery rates, often in one view.

Under strict isolation every aggregate becomes a REST fan-out across five
services, and any *join* across services (e.g. "listings per verified dealer")
must be assembled in application memory.

Two options, neither clean:

**7a. No exception.** Admin calls every service. Each service exposes the
aggregates admin needs. Purest, and the most endpoints to build — every new
dashboard panel is a new endpoint on someone else's service.

**7b. Read-only exception.** Admin gets `SELECT` on all schemas, documented as
deliberate. All admin *mutations* still go through the owning service's API.

```sql
-- EXCEPTION: internal, trusted, read-only reporting consumer.
-- Mutations are NOT granted — approving a listing or verifying a dealer
-- goes through that service's API.
GRANT USAGE ON SCHEMA auth, marketplace, ingestion, notification TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA auth        TO admin_service_role;
-- ... etc
```

**Be honest about 7b:** it is Plan B for one service. Whether that is a
pragmatic carve-out or the crack that makes the whole model rhetorical is a
judgement call worth putting to someone experienced.

---

## 8. Search stays inside marketplace-service

Search must filter and vector-order the *same rows*:

```sql
SELECT id, make, model, 1 - (embedding <=> $1::vector) AS score
FROM marketplace.vehicles
WHERE status = 'LIVE' AND seats = $2
ORDER BY embedding <=> $1::vector
LIMIT 20;
```

This is not a cross-service query — `vehicles` belongs to marketplace — so it
is fully compatible with Plan A.

Deploy search as a **separate Lambda within marketplace-service** so MiniLM
(~3 GB) is sized independently of CRUD endpoints (256 MB). Separate
deployment unit, same service, same schema. This preserves the single-SQL
statement the search design calls its "entire justification" for one
PostgreSQL instance.

Splitting search into its own *service* would require a synced copy of every
listing plus its vector — a replication pipeline and eventual consistency, for
no benefit that the separate-Lambda approach does not already provide.

---

## 9. Reference data (makes, models, aliases)

Plan A's genuinely unresolved problem.

Both search and ETL need the same make/model vocabulary — the designs warn
that if ingest stores `MERCEDES-BENZ` while search queries `Mercedes`, the
mismatch returns zero results **silently**. Both also describe an alias
promotion loop where logged corrections become dictionary entries, so the
parser gets cheaper with use. That requires *writes* from both services.

Under strict isolation, shared mutable state is exactly what is forbidden.

| Option | Verdict |
|---|---|
| Shared `reference` schema, both read+write | Violates the plan. Honest, but an exception. |
| Owned by one service, exposed over REST | Isolation-clean. A per-token HTTP call during parsing is likely too slow. |
| Duplicated in a shared npm library | No `pg_trgm` — `similarity()` cannot run against a JS array. Fuzzy matching would need reimplementing without an index. Alias promotion needs a redeploy. |
| Owned by one service + cached snapshots | Most workable: one service owns the table; others pull a snapshot at container init and cache it. Matches what the ETL design already specifies for the Groq Lambda. Writes (alias promotion) go through the owner's API. |

**Recommendation:** the last option. It is the only one that keeps trigram
matching, allows alias promotion, and does not require a per-token network
call.

---

## 10. Pros

**The boundary is real and enforced.** Not a convention people remember —
PostgreSQL refuses. A junior developer *cannot* accidentally couple two
services with a join, because the query errors.

**Splitting to separate databases later is a config change.** No service holds
a query that spans schemas, so moving `auth` to its own instance means
changing one connection string. This is the strongest long-term argument.

**Ownership is unambiguous.** Each schema has exactly one writer. When
`vehicles` has bad data there is one service to look at. With five people on
five services, this removes a whole category of "who wrote this row?"

**Service contracts become explicit.** The API surface between services is
written down, versioned, and testable, instead of being an implicit set of
joins discovered by grepping.

**Matches the multi-repo goal.** The README states each service becomes its
own repository. Plan A is the model that survives that split unchanged.

**Independent deployability is genuine.** Because no service reads another's
tables, a schema change inside `auth` cannot break marketplace at runtime —
only an API change can, and API changes are visible.

---

## 11. Cons

**1–2 weeks of infrastructure work with no user-visible feature.** Clients,
internal endpoints, service-to-service auth, retries, circuit breakers, test
doubles, batch endpoints. On a semester timeline this is real cost.

**The ETL design's concurrency model is invalidated.** §14–15 must be
rewritten (§6.1 above). This is the most concrete casualty.

**N+1 queries become a permanent hazard.** A listing page for 20 vehicles
needs 20 dealer lookups unless a batch endpoint exists. Every such surface
needs one, and forgetting is easy.

**Every internal call is a new failure mode.** What was a join that either
worked or did not is now a call that can time out, return 503, or partially
succeed. Every consumer needs a degradation story.

**Latency accumulates.** A listing page becomes: query vehicles → call auth →
merge. Two round trips minimum, and on Lambda the second may hit a cold start.

**Cross-service reporting becomes hard.** "Listings per verified dealer" is
one SQL join under Plan B, and an application-memory join over two API
responses under Plan A — which does not paginate or aggregate well.

**Reference data has no clean home** (§9). Any answer is a compromise.

**Admin needs an exception** (§7), and that exception is Plan B in miniature.

**Harder to debug.** Reproducing a bug locally may require running three
services instead of querying one database.

---

## 12. Implementation order

1. **Test the FK question in §4.** It determines 4a vs 4b, and everything else
   is built on the answer. Do this first.
2. Init scripts: extensions, schemas, roles.
3. Migrations for all 13 tables (FKs per the §4 outcome).
4. `grants.sql` — own-schema only, plus the §7 admin decision.
5. Run and **verify**: cross-schema `SELECT` must fail; own-schema must work.
6. Per-service TypeORM config and entities. No view-entities — they are
   illegal in this plan.
7. `AuthClient` interface + local HTTP implementation.
8. Internal endpoints on auth-user-service.
9. `POST /internal/vehicles/bulk` on marketplace-service (§6).
10. `MarketplaceClient` in ingestion-service.
11. Rewrite the ETL concurrency section.

Steps 1–6 are roughly a day. Steps 7–11 are the 1–2 weeks.

---

## 13. Choose this plan if

- Separate databases per service is a real future goal, not a hypothetical.
- The team is large enough or distributed enough that enforced boundaries
  prevent more pain than they cause.
- The multi-repo split in the README is definitely happening.
- You can afford 1–2 weeks of non-feature work now.
- You are prepared to rewrite the ETL design's concurrency argument.

## 14. Do not choose this plan if

- The timeline is tight and the ETL pipeline is the priority.
- The team is small and co-located, where boundaries are cheap to maintain
  socially.
- Cross-service reporting is a major feature.
- You are not yet certain the service boundaries themselves are right —
  strict isolation makes them expensive to move.
