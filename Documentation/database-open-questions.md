# Database Architecture — Open Questions

> **Status:** unresolved. This document exists to be taken to someone with
> production microservices experience. Nothing here is implemented; a first
> attempt was written and deliberately removed pending these answers.
>
> **Context:** 5 NestJS services deployed as AWS Lambda, one PostgreSQL
> (pgvector) database, TypeORM migrations. ERD in `ERD.png` (13 tables).
> Search and ETL designs in `intelligent-search.pdf` and `etl-pipeline.pdf`.

---

## The core tension

Two commitments in the existing design pull in opposite directions, and every
question below is a consequence of that.

**Commitment 1 — one PostgreSQL instance, from the search design:**

> Filtering and ordering happen in one SQL statement, not three separate
> queries merged in the application. *This is the entire justification for
> co-locating everything in one PostgreSQL instance* — if listings and vectors
> lived apart, this single query would be impossible and would require
> duplicating and syncing data.

**Commitment 2 — microservice isolation:** services should not reach into
each other's data. Communication should be through APIs, so services can be
developed, deployed, and reasoned about independently.

One database makes cross-service SQL *possible*. Isolation says it must not
happen. The question is where exactly to draw the line, and what it costs.

---

## Q1 — Isolation model

Three positions, in increasing strictness.

### A. Shared schema, convention-only separation
All tables in `public`. Services separated by table naming and by which
entity classes they load. Any service's credentials can touch any table.

- ➕ Simplest. Joins work everywhere. No coordination overhead.
- ➖ No enforced boundary. One careless query couples two services silently.
- ➖ A future split into separate databases is a rewrite.

### B. Schema-per-service, reads may cross, writes may not
`auth`, `marketplace`, `ingestion`, `notification`, `admin` schemas. Each
service gets a PostgreSQL role with full CRUD on its own schema and `SELECT`
on specific foreign tables where a foreign key exists.

- ➕ Postgres enforces that no service can corrupt another's data.
- ➕ Display joins (listing → dealer name) stay one query.
- ➖ Read coupling is real: a schema change breaks another service's query.
- ➖ Splitting databases later means finding and rewriting every join.

### C. Strict isolation — no cross-schema access at all
Each role sees only its own schema. Every cross-service read is a REST call.

- ➕ True independence. Splitting to separate databases is a config change.
- ➖ Listing page for 20 vehicles needs a batch dealer lookup endpoint.
- ➖ Every internal call can fail: timeouts, retries, circuit breakers.
- ➖ **Breaks the ETL loader** — see Q3.

### D. Duplication + events
Each service stores what it needs in its own schema; changes propagate by
events (e.g. `UserUpdated` → marketplace updates its copy of dealer name).

- ➕ Full independence, no synchronous coupling.
- ➖ Eventual consistency. Requires an event pipeline that does not exist yet.

**Ask:** For a 5-service system with one database, a ~4-month timeline, and a
5-person team, is B a reasonable middle ground or a trap that becomes A in
practice? Is C worth ~1–2 weeks of infrastructure work with no user-visible
feature?

---

## Q2 — Cross-schema foreign keys under isolation

`marketplace.vehicles.dealer_id` references `auth.users.id`. Six such FKs
exist (vehicles, upload_jobs, favourites, search_queries, notifications,
audit_logs — all → `auth.users`).

1. **Keep the FK constraints, forbid only queries.** Postgres enforces
   integrity; grants deny access. Data can never be orphaned.
2. **Drop cross-schema FKs.** Plain `uuid` columns. Fully decoupled;
   orphaned references become possible and invisible.
3. **Drop them but add an integrity-check job** that reports orphans.

**Unverified technical question, important:** if a role has *no* privilege on
`auth`, can it still `INSERT` into a table whose FK references `auth.users`?
FK validation runs as the system rather than the inserting user, so this
*should* work — but it was never tested. If it fails, options 1 and C are
incompatible and the choice collapses.

**Ask:** Is "FK constraints present but the referencing service cannot read
the referenced table" a sane configuration, or a contradiction that will
surprise us later?

---

## Q3 — The ETL loader write path

The ETL design has `loadFn` bulk-inserting ~100 rows per chunk into
`marketplace.vehicles`, with `MaxConcurrency: 10` on the Step Functions Map
state. The design explicitly justifies that concurrency limit as protection
for the RDS connection pool — `loadFn` is stated to be the only stage holding
a write connection.

Under strict isolation, ingestion cannot write to `marketplace.vehicles`.

1. **HTTP POST to marketplace-service.** A bulk endpoint accepting ~100 rows.
   Needs: partial success semantics (98 inserted, 2 failed), idempotency
   (Step Functions retries), ~500 KB payloads with 384-dim embeddings.
   **Invalidates the documented concurrency argument** — pool pressure moves
   from ingestion to marketplace, and `MaxConcurrency: 10` needs
   re-justifying.
2. **Move `vehicles` into the ingestion schema.** Ingestion owns it outright.
   But then marketplace does not own its core entity, and search (which lives
   in marketplace) can no longer run its single SQL statement.
3. **Keep the direct write as a documented exception.** Preserves the ETL
   design exactly; leaves one real hole in the isolation story.

**Ask:** Is writing another service's table over HTTP, in the middle of a
Step Functions pipeline, worth it? Or is a documented direct-write exception
for a trusted internal producer the pragmatic answer?

---

## Q4 — Should search be its own microservice?

Search needs pgvector similarity ordering over the *same rows* it filters:

```sql
SELECT id, make, model, 1 - (embedding <=> $1::vector) AS score
FROM vehicles
WHERE status = 'ACTIVE' AND seats = $2
ORDER BY embedding <=> $1::vector
LIMIT 20;
```

The `WHERE` and `ORDER BY` hit the same row, which is why the design insists
on co-location.

1. **Search stays in marketplace-service**, deployed as a separate Lambda so
   MiniLM (~3 GB memory) is sized independently of CRUD endpoints (256 MB).
   Preserves the single SQL statement.
2. **Separate search-service** with its own schema and a synced copy of
   listings + embeddings, updated by events. True isolation and independent
   scaling, at the cost of a replication pipeline and duplicated vectors.

**Ask:** Is "separate Lambda, same service and schema" a legitimate way to
get independent scaling without splitting the service — or is it a fudge that
means the boundary was drawn wrong?

---

## Q5 — Reference data (makes, models, aliases)

The search design's typo correction uses `pg_trgm` against dictionary tables:

```sql
SELECT canonical_name, similarity(name, $1) AS score
FROM makes WHERE similarity(name, $1) > 0.8 ORDER BY score DESC LIMIT 5;
```

Both search and ETL need the *same* vocabulary — the design warns that if
ingest stores `MERCEDES-BENZ` while search queries `Mercedes`, the mismatch
fails silently with zero results.

Both designs also describe an **alias promotion loop**: corrections logged
often enough get promoted into the dictionary, so the parser gets cheaper
with use. That requires writes.

1. **Hardcode in a shared library.** No table. But `similarity()` cannot run
   against a JS array — fuzzy matching would have to be reimplemented in
   application code without an index. Alias promotion needs a redeploy.
2. **A `reference` schema readable by both.** Enables trigram matching and
   alias writes — but it is shared mutable state between two services, which
   contradicts strict isolation.
3. **Owned by one service, exposed over REST.** Isolation-clean, but a
   per-token HTTP call during parsing is likely too slow.
4. **Table + in-memory cache.** Table is the source of truth; each service
   caches at container init. The ETL design already describes this for the
   Groq Lambda's make/model resolution.

**Ask:** Reference data shared by two services — table, library, or service?
Does option 4's cache make the shared table acceptable?

---

## Q6 — Migration ownership

One central `database/` package owning all schemas, or per-service migrations?

1. **Central package.** One source of truth, runs once in CI before deploys.
   But: whoever owns a schema does not own its migrations, and in a multi-repo
   setup this package has no natural home.
2. **Per-service migrations.** Each service migrates its own schema. Matches
   ownership and multi-repo. But cross-schema FKs create ordering
   dependencies — `marketplace.vehicles` cannot be created before
   `auth.users` exists.

**Ask:** With cross-schema FKs, is per-service migration ownership workable,
or does the ordering problem force a central package?

---

## Q7 — Repository layout

The README states each service is intended to become an independent GitHub
repository. Currently one repo, and PRs are already merging per-service.

If split, the `database/` package has no obvious home. And cross-service type
definitions (the shape of another service's API response) would need either
duplication or a published contracts package.

**Ask:** At what point does multi-repo pay for itself? Is a shared contracts
package worth it at 5 services, or is duplication cheaper?

---

## Q8 — Service-to-service transport

API Gateway handles north-south (browser → service). East-west
(service → service) is a separate decision:

1. **Direct Lambda invoke** — lowest latency, IAM-authorized, natural for an
   all-Lambda architecture. But local development has no Lambda.
2. **Internal ALB / private API Gateway** — real HTTP, uniform with local dev,
   more infrastructure and latency per hop.
3. **Abstract client interface**, HTTP locally and Lambda invoke on AWS.
   Callers never know the transport. More code, defers the decision.

**Ask:** For Lambda-to-Lambda in the same account, is direct invoke standard
practice, or does the loss of HTTP semantics (status codes, middleware,
tracing) cost more than it saves?

---

## Q9 — Admin service reads

Admin dashboards and reports are inherently cross-cutting — counts of users,
listings, upload jobs, notification delivery rates.

Under strict isolation, every aggregate becomes a REST fan-out across five
services. The alternative is a read-only role with `SELECT` on all schemas,
documented as a deliberate exception.

**Ask:** Is a read-only cross-cutting role for an internal reporting consumer
an acceptable exception, or the first crack that makes isolation meaningless?

---

## Q10 — Local development ergonomics

With five services, each needing its own Postgres role and connection string,
plus a shared database container:

- One `.env` at the root with all six connection strings, or one per service?
- Do developers run all five services locally, or only the one they work on
  plus stubs?
- Init scripts (`docker-entrypoint-initdb.d`) only run when the data volume is
  empty, so changing roles or schemas requires destroying the database. Is
  that acceptable, or should role creation live in migrations instead?

**Ask:** What does a sane local setup look like for a 5-person team where
each person owns one service?

---

## Decisions already made (for context)

| Decision | Choice | Reason |
|---|---|---|
| Database engine | PostgreSQL + pgvector | Search design needs pgvector, pg_trgm, tsvector in one query |
| ORM | TypeORM | Already in the scaffold |
| `synchronize` | Always `false` | Multiple services on one database; auto-sync would reshape shared tables |
| Enum columns | `varchar` + `CHECK` | Native PG enums are hard to alter; the body-type enum is expected to grow |
| Embeddings | `vector(384)` | all-MiniLM-L6-v2; model parity between ingest and search is mandatory |

---

## What was tried and removed

A full schema-per-service implementation was written on 2026-08-03 and
removed the same day, unexecuted. It comprised 14 TypeORM migrations covering
the ERD, a `grants.sql` implementing least-privilege roles, Docker init
scripts for extensions/schemas/roles, per-service TypeORM configs, and entity
classes.

It was removed because Q1 (isolation model) and Q3 (ETL write path) were
still being renegotiated while the code was being written — the schema kept
changing shape underneath. The work is recoverable from git history if a
decision later matches it.

**Recommended sequence once answers are in:** settle Q1 first — it determines
Q2, Q3, Q5, and Q9. Then Q6 and Q7 together, since migration ownership and
repo layout are the same question. Q4 and Q8 are independent and can wait.
