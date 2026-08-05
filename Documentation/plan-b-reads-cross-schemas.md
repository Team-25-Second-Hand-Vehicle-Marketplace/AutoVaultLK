# Plan B — Reads Cross Schemas, Writes Go Through REST

> **Model:** Schema-per-service. A service may `SELECT` from another schema
> where a foreign key already links them. No service may ever `INSERT`,
> `UPDATE`, or `DELETE` outside its own schema — **except one documented
> exception**: ingestion-service writes directly to `marketplace.vehicles`
> and `marketplace.vehicle_images` during the ETL load. See §6.
>
> **Companion:** [Plan A — Strict Isolation](./plan-a-strict-isolation.md).
> Open questions behind both: [database-open-questions.md](./database-open-questions.md).
>
> **Status:** current, as of the latest revision. §9 (reference data
> ownership) is explicitly **not yet final** — see that section.

---

## 1. The idea in one paragraph

The asymmetry is the whole design: **a stale read is recoverable, a bad write
is not.** Reading another service's row gives you data that might be a few
milliseconds old. Writing another service's row can violate invariants that
service is responsible for, and nothing will catch it. So reads are permitted
where a foreign key already declares a relationship, and writes are permitted
nowhere but your own schema. The database enforces the write boundary; the
read boundary is deliberately left open so that joins — including the single
SQL statement the search design depends on — remain possible.

**The governing principle:** *you may look at another service's data; you may
never change it.*

---

## 2. Schema and ownership map

| Schema | Owner | Tables |
|---|---|---|
| `auth` | auth-user-service | `users`, `dealer_profiles`, `refresh_tokens` |
| `marketplace` | marketplace-service | `vehicles`, `vehicle_images`, `favourites`, `search_queries` |
| `ingestion` | ingestion-service | `upload_jobs`, `rejected_records`, `etl_stage_logs` |
| `notification` | notification-service | `notifications` |
| `admin` | admin-service | `audit_logs` |

Ownership means: whoever owns a schema owns its migrations, and is the **only
writer** of its tables.

---

## 3. What the grants look like

```sql
-- Own schema: full CRUD. Repeated per service.
GRANT USAGE ON SCHEMA marketplace TO marketplace_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA marketplace TO marketplace_service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketplace
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO marketplace_service_role;

-- ─── Cross-schema READS, justified by an existing foreign key ───
-- marketplace.vehicles.dealer_id → auth.users.id
GRANT USAGE  ON SCHEMA auth TO marketplace_service_role;
GRANT SELECT ON auth.users           TO marketplace_service_role;
GRANT SELECT ON auth.dealer_profiles TO marketplace_service_role;

-- ingestion.upload_jobs.dealer_id → auth.users.id
GRANT USAGE  ON SCHEMA auth TO ingestion_service_role;
GRANT SELECT ON auth.users TO ingestion_service_role;

-- notification.notifications.user_id → auth.users.id
GRANT USAGE  ON SCHEMA auth TO notification_service_role;
GRANT SELECT ON auth.users TO notification_service_role;

-- Dealer review dashboard shows upload job status alongside listings
GRANT USAGE  ON SCHEMA ingestion TO marketplace_service_role;
GRANT SELECT ON ingestion.upload_jobs TO marketplace_service_role;

-- ─── DOCUMENTED EXCEPTION — the only cross-schema write in this plan ──────
-- ingestion-service writes marketplace.vehicles and marketplace.vehicle_images
-- directly, bypassing REST, during the ETL bulk load. See §6 for the full
-- justification. Scope is INSERT + UPDATE only — never DELETE.
GRANT USAGE ON SCHEMA marketplace TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicles       TO ingestion_service_role;
GRANT SELECT, INSERT, UPDATE ON marketplace.vehicle_images TO ingestion_service_role;

-- ─── NO other cross-schema INSERT / UPDATE / DELETE anywhere. ───
-- Any write grant crossing a schema boundary, other than the one exception
-- above, violates this plan.
```

### 3.1 The rule for adding a grant

A cross-schema `SELECT` is allowed **only if a foreign key already links the
two tables.** The FK is the justification; without one, the relationship is
not modelled and the read should be an API call.

This rule is what stops Plan B decaying into "everyone reads everything."
Without it there is no principled place to stop.

A cross-schema **write** is allowed only for the single named exception in
§6. There is no general rule for adding more write grants — each one would
need the same weight of justification the ETL exception required, and should
be treated as a rare, deliberate departure rather than a pattern to repeat.

---

## 4. Cross-schema foreign keys: kept

All six FKs to `auth.users.id` stay. They are load-bearing here in a way they
are not in Plan A:

- They enforce referential integrity — no orphaned `dealer_id`.
- They **justify** the read grants (§3.1).
- They make the joins this plan permits actually correct.

Within-schema FKs (`vehicle_images → vehicles`, `refresh_tokens → users`,
`rejected_records → upload_jobs`) are unchanged and continue to cascade.

No unverified behaviour here — a role that holds `SELECT` on the referenced
table can certainly insert a referencing row. Plan A's open question in its §4
does not arise.

---

## 5. Cross-schema entity classes

TypeORM is per-service: marketplace-service's `DataSource` only knows entities
registered in *its* config. To join to `auth.users` it needs a local class
describing that table.

```ts
/**
 * Read-only projection of auth.users, owned by auth-user-service.
 * Declared here only so marketplace can join on vehicles.dealer_id.
 * Never migrated by this service.
 *
 * password_hash is deliberately absent. marketplace_service_role holds only
 * SELECT on this table, so it could be read but never written — narrow the
 * grant to specific columns if that is not tight enough.
 */
@Entity({ schema: 'auth', name: 'users', synchronize: false })
export class AuthUserView {
  @PrimaryColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'varchar', length: 255 }) email: string;
  @Column({ name: 'is_active', type: 'boolean' }) isActive: boolean;
}
```

`synchronize: false` on the entity means this service never migrates that
table. Three services need this file (marketplace, ingestion, notification).

**The maintenance cost:** if auth renames a column, these copies rot. In one
repo you can at least see them side by side. Split into separate repos and the
drift becomes invisible — see §11.

---

## 6. The ETL write path — a documented exception, not a REST call

Ingestion's `loadFn` writes ~100 rows per chunk to `marketplace.vehicles` and
`marketplace.vehicle_images`. This is a cross-schema write, and Plan B's
general rule forbids it — but this one case is carved out explicitly, rather
than converted to REST. This is a deliberate departure from what earlier
drafts of this plan proposed, made because the alternative was worse than the
isolation violation.

### 6.1 Why the exception exists

The ETL design justifies `MaxConcurrency: 10` on the Step Functions Map state
as protection for the RDS connection pool `loadFn` holds — the design states
`loadFn` is the only stage holding a write connection, and the concurrency
limit exists specifically to bound that pool's pressure.

Converting this to an HTTP bulk endpoint (`POST /internal/vehicles/bulk`)
moves that pressure onto marketplace-service's own connection pool — now
shared with live buyer search traffic — and invalidates the sizing argument
the ETL design spends real effort justifying, without providing a replacement
argument. It would also require solving partial-success semantics (98 of 100
rows insert, 2 fail), idempotency under Step Functions retries, and payload
sizing (~500 KB per chunk with embeddings included) — real work for a path
that already functions correctly as a direct write.

**The exception avoids all of this.** `loadFn` keeps its direct connection,
the concurrency argument in the ETL design stays valid as written, and the
isolation cost is confined to one clearly-scoped, clearly-documented grant.

### 6.2 Scope of the exception, precisely

- **Tables:** `marketplace.vehicles` and `marketplace.vehicle_images` only —
  both are needed; `loadFn`'s image-processing stage writes the second table,
  and granting only the first will fail partway through a chunk.
- **Verbs:** `SELECT`, `INSERT`, `UPDATE`. **Never `DELETE`.** Ingestion adds
  and corrects listings; it never removes them. Removal is marketplace's
  decision alone.
- **`UPDATE` is required, not optional** — re-running a failed upload job, or
  a dealer's CSV correcting a `registration_number` that already exists,
  needs `UPDATE`, not just `INSERT`. Scoping the grant to `INSERT` only will
  make idempotent retries fail.
- **`SELECT` on `marketplace.vehicles`** — checking for an existing listing
  during a re-run is a read, independently justified by the FK from
  `vehicles.upload_job_id` per the §3.1 rule, and needed regardless of the
  write exception.

This is the exact grant shown in §3.

### 6.3 What this means for the ETL design document

Because the direct write is preserved, **the ETL design's `MaxConcurrency: 10`
connection-pool argument does not need to be rewritten under this plan.** This
is the concrete payoff of choosing the exception over the REST conversion —
Plan B's earlier draft claimed this rewrite was unavoidable; it is not, once
the write is treated as a scoped exception rather than forced through REST.

One thing still worth re-confirming, not rewriting: the pool `loadFn` writes
into is `marketplace`'s pool specifically, shared with buyer-facing search
traffic. `MaxConcurrency: 10` was sized against *some* pool's capacity: worth
a sanity check that marketplace's pool, under normal buyer load plus ETL
load, still supports that number — not a redesign, just a number to verify.

---

## 7. Admin service

Admin gets `SELECT` on all four other schemas — under Plan B this needs no
special pleading, it is simply the same rule applied to a service whose job is
cross-cutting reads.

Admin **mutations** still go through the owning service's API: approving a
listing calls marketplace-service; verifying a dealer calls auth-user-service.

```sql
GRANT USAGE ON SCHEMA auth, marketplace, ingestion, notification TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA auth         TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA marketplace  TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA ingestion    TO admin_service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA notification TO admin_service_role;
-- plus ALTER DEFAULT PRIVILEGES for each, for future tables
-- NO UPDATE / INSERT / DELETE grants.
```

Dashboard queries stay real SQL. "Listings per verified dealer" is one join,
not an application-memory merge of two paginated API responses.

---

## 8. Search stays inside marketplace-service

Identical to Plan A, and for the same reason:

```sql
SELECT id, make, model, 1 - (embedding <=> $1::vector) AS score
FROM marketplace.vehicles
WHERE status = 'LIVE' AND seats = $2
ORDER BY embedding <=> $1::vector
LIMIT 20;
```

`vehicles` belongs to marketplace, so this is not a cross-service query under
either plan. Deploy search as a separate Lambda (MiniLM needs ~3 GB; CRUD
endpoints need 256 MB) within the same service and schema.

Plan B additionally allows search to *filter on dealer verification status*
via a join to `auth.dealer_profiles` — something Plan A would require
pre-fetching every dealer to achieve. Whether that matters depends on whether
"only show listings from verified dealers" is a requirement.

---

## 9. Reference data (makes, models, aliases) — ⚠ NOT YET FINAL

> **Status: open.** The ownership question below has two live candidates and
> is intentionally left unresolved here pending a decision. Do not implement
> against this section until it is updated. This replaces an earlier draft of
> this section, kept below only as a record of the option not yet chosen.

### 9.1 What is settled

Both search and ETL need the same make/model vocabulary — the designs are
explicit that if ingest stores one spelling and search queries another, the
mismatch returns zero results silently. Typo correction against this
vocabulary needs `pg_trgm`, which requires a real, indexed table — a
hardcoded list in application code cannot support `similarity()` queries.
Both designs also describe an alias-promotion loop: corrections logged often
enough get promoted into the dictionary, so the parser gets cheaper with use.
That promotion is a write.

So: `makes`, `models`, and `aliases` must exist as real tables, somewhere,
readable by both marketplace-service (search/parsing) and ingestion-service
(ETL normalization), with a path for aliases to grow over time. That much is
fixed regardless of which option below is chosen.

### 9.2 Option A — separate `reference` schema, both services write it

A dedicated `reference` schema, read by both, with both also holding
`INSERT`/`UPDATE` on `aliases` directly for the promotion loop.

- ➕ Symmetric — neither service is privileged over the other for shared
  vocabulary that arguably belongs to neither.
- ➖ A second two-writer exception, on top of §6's ETL exception. Two
  documented write exceptions is a materially different story than one.

### 9.3 Option B — owned by marketplace-service, ingestion reads + caches

Reference tables live inside the `marketplace` schema (not a separate one),
owned solely by marketplace-service. Ingestion gets `SELECT` only, loads a
snapshot into memory at container init and refreshes periodically — matching
what the ETL design already specifies for the Groq Lambda's make/model
resolution, which explicitly is not a live per-row query. Alias promotion
from ingestion goes through marketplace's API rather than a direct write,
since it is low-frequency and an API call is cheap at that volume.

- ➕ Only one write exception in the whole plan (§6), not two. Simpler
  isolation story.
- ➕ Matches the existing decision that make/model vocabulary is marketplace
  vocabulary — search already lives there.
- ➖ Ingestion's alias promotions depend on marketplace's API being available
  during the ETL pipeline — a new dependency the direct-write version doesn't
  have.

### 9.4 Decision pending

Leaning toward Option B at the time of writing, on the grounds that it keeps
the plan to exactly one write exception — but this has not been confirmed.
**Update this section, and the grants in §3, once decided.**

---

## 9A. Silent drift risks — a checklist for code review

Plan B's read boundary is enforced by convention, not by the database (§3.1,
§11). That convention only holds if the specific places it can quietly break
are known and checked deliberately. This section exists so a reviewer has a
concrete list to check against, rather than a vague sense that "coupling is
possible somewhere."

Each of these is a place where **two or more services must agree on a shape
neither of them can see the other enforcing.** Nothing fails loudly when they
drift — the failure is a wrong result, a silent zero-row match, or a runtime
error discovered by a user before a developer.

**1. Cross-schema view-entities** (§5) — `AuthUserView` and equivalents.
Three services (marketplace, ingestion, notification) each hold their own
hand-written copy of a subset of `auth.users`'s shape. If auth-user-service
renames or removes a column those copies reference, nothing at the TypeScript
level catches it — the break surfaces as a runtime SQL error in a service
that was never touched by the change that caused it.
*Check during review:* any migration touching `auth.users`,
`auth.dealer_profiles`, `ingestion.upload_jobs`, or any other table with a
cross-schema reader — search the other services for a matching view-entity
before merging.

**2. Reference table access** (§9) — whichever ownership option is chosen,
ingestion-service depends on marketplace-service's `makes`/`models`/`aliases`
shape and refresh behavior. A cached snapshot loaded at container init is
correct only as long as the caching service knows when to refresh it — a
schema change to `models` that isn't reflected in ingestion's cache-loading
code produces stale or missing matches with no error at all.
*Check during review:* a schema change to reference tables should prompt an
explicit check of every service holding a cached snapshot, not just the
owning service's own code.

**3. The `KNOWN_SPEC_KEYS` / `specFilters` dictionary** — this single
concept must stay identical across three independent places that do not
share code by default:
   - the rule-based parser's Stage 3 exact-match dictionary (marketplace),
   - the LLM prompt's `allowed_spec_keys` block sent to Groq (marketplace),
   - the SQL builder that turns `specFilters` into `WHERE specs->>'x'`
     clauses (marketplace).

   Unlike risks 1–2, this one is *not* a cross-service risk — all three
   copies currently live inside marketplace-service. It is included here
   because it is the same class of failure (multiple places required to
   agree on one shape, nothing enforcing agreement) and because ingestion's
   ETL enrichment stage, which populates `specs` on write, is a fourth place
   that must also agree with the other three, making it cross-service after
   all.
*Check during review:* `KNOWN_SPEC_KEYS` should be one exported constant,
imported by the parser, the prompt builder, and the SQL builder — never
three hand-maintained lists. If a PR adds a new spec key in only one of
those places, that is the drift this item exists to catch.

**4. The ETL write exception's schema assumptions** (§6) — `loadFn` writes
directly to `marketplace.vehicles` and `marketplace.vehicle_images` using
column names it must get right without a compiler checking it against
marketplace-service's actual entity definitions, since ingestion-service does
not import marketplace's TypeORM entities. A column rename in marketplace's
migrations silently breaks the ETL load path.
*Check during review:* any migration renaming or removing a column on
`vehicles` or `vehicle_images` should prompt a check of `loadFn`'s insert
statement.

**General rule for this list:** every entry above is a place where grep is
the enforcement mechanism, not the compiler or the database. When touching
any table these four items reference, search for the other side before
assuming the change is local.

---

## 10. Pros

**The write boundary is real and enforced.** No service can corrupt another's
data. PostgreSQL refuses. This is the property that actually matters most —
data corruption is the failure you cannot recover from.

**The search design's core premise survives intact.** Filtering and vector
ordering stay in one SQL statement, which the design calls the "entire
justification" for co-locating everything in one PostgreSQL instance.

**Dramatically less infrastructure work than Plan A.** One client to build
(ingestion → marketplace, for the ETL load) instead of a full mesh. Roughly
days rather than 1–2 weeks.

**No N+1 problem for display data.** A listing page for 20 vehicles is one
query with a join, not 20 lookups or a batch endpoint you must remember to
build.

**Cross-service reporting stays SQL.** Admin dashboards and any analytics
remain joins, with real pagination and aggregation.

**Fewer failure modes.** A join either works or it does not. There is no
timeout, no retry policy, no circuit breaker, and no partial-success handling
for reads.

**Easier local development and debugging.** Reproducing a bug means querying
one database, not running three services.

**Ownership is still unambiguous.** Exactly one writer per schema. "Who wrote
this row?" has one answer, which is the main thing five people on five
services need.

---

## 11. Cons

**Read coupling is real coupling.** If auth renames `users.name`, three
services' queries break — at runtime, not compile time. The FK rule (§3.1)
bounds this but does not eliminate it.

**Cross-schema entity classes duplicate another service's schema** (§5), and
this is one of several silent-drift risks the system now carries — see §9A
for the full list. They drift silently when the owner changes a column. In a
multi-repo split this gets meaningfully worse, and pushes toward a published
contracts package.

**A future split into separate databases is a rewrite, not a config change.**
Every cross-schema join must be found and converted to an API call. This is
the single strongest argument for Plan A.

**The read boundary is a convention, not enforced.** Grants stop a service
reading a table it has no grant for — but adding a grant is one line, and
nothing prevents someone adding it without justification. Plan A has no such
slope because the answer to every cross-schema request is "no."

**"Only if an FK exists" requires discipline to hold.** It is a good rule,
but it is a code-review rule, not a mechanical one.

**The ETL write exception is a real, if scoped, hole in the isolation story**
(§6). It preserves the ETL design's concurrency argument unchanged — which is
the reason it exists — but it means the write boundary is not, in fact,
absolute. One service can write another's table, by design, and that design
must be remembered and re-justified any time it's questioned.

**Weaker fit with the multi-repo goal.** The README targets independent
repositories per service. Plan B's cross-schema entities and joins assume the
schemas are visible together.

**"Independently deployable" becomes partly untrue.** A change to `auth.users`
can break marketplace at runtime even though marketplace was not redeployed.

---

## 12. Implementation order

1. Init scripts: extensions, schemas, roles.
2. Migrations for all 13 tables, cross-schema FKs included.
3. `grants.sql` — own-schema CRUD, cross-schema `SELECT` justified by FKs,
   plus the one ETL write exception (§6.2).
4. Run and **verify**: cross-schema `SELECT` succeeds where granted; the ETL
   exception's `INSERT`/`UPDATE` succeed on `vehicles`/`vehicle_images` but
   `DELETE` fails; all other cross-schema writes fail; own-schema CRUD works.
5. Per-service TypeORM config and entities, including the view-entities in §5.
6. `loadFn` in ingestion-service writes directly to `marketplace.vehicles` /
   `vehicle_images` using the grant from step 3 — no bulk REST endpoint
   needed for this path.
7. **Decide reference table ownership (§9)** before building the parser —
   this determines whether step 8 needs an ingestion→marketplace API client
   or not.
8. Reference tables (§9), once ownership is decided.
9. Re-confirm (not rewrite) the ETL `MaxConcurrency: 10` sizing against
   marketplace's connection pool (§6.3).

Steps 1–6 are roughly a day. Step 7's decision should happen before the
parser work starts, since it changes what step 8 requires.

---

## 13. Choose this plan if

- Delivering the ETL pipeline and search is the priority this semester.
- The team is small and co-located, where a code-review rule is enough.
- Cross-service reporting or admin dashboards matter.
- Separate databases per service is a "maybe someday", not a commitment.
- You want the write-safety property without paying for a full service mesh.

## 14. Do not choose this plan if

- Separate databases per service is a real, dated goal.
- The multi-repo split is definitely happening soon.
- The team is large or distributed enough that conventions will not hold.
- Your assessment explicitly rewards textbook microservice isolation.

---

## 15. Honest comparison

| | Plan A | Plan B |
|---|---|---|
| Cross-schema reads | ✗ REST | ✓ SQL join (FK-justified) |
| Cross-schema writes | ✗ REST, no exceptions | ✗ REST, **except the ETL exception (§6)** |
| Boundary enforcement | Database | Database (writes, minus 1 exception), review (reads) |
| Clients to build | ~5 | 0–1, depending on §9's decision |
| Extra infra work | 1–2 weeks | a day or two |
| Single-SQL search | ✓ | ✓ |
| ETL concurrency rewrite | required | **not required — see §6.3** |
| N+1 risk | high | none for display data |
| Split to separate DBs later | config change | rewrite, and the ETL exception needs its own migration path |
| Reference data | compromised (§9) | **not yet decided (§9)** |
| Multi-repo fit | strong | weak |
| Silent-drift surface | small (no cross-schema entities) | real — see §9A for the checklist |

**The decision in one sentence:** Plan A buys future optionality — the ability
to split databases cheaply — at roughly 1–2 weeks of present cost plus ongoing
latency and failure-handling complexity. Plan B buys immediate velocity and
keeps both the search design's premise *and* the ETL design's concurrency
argument intact, at the cost of read coupling that becomes expensive to
unwind later, plus one deliberate write exception that must stay documented
and re-justified rather than forgotten.

The two plans no longer forbid cross-schema writes identically — Plan B
carries one scoped exception Plan A does not. That exception is what lets
Plan B avoid the ETL rewrite Plan A still requires. **The differentiators are
now reads (as before) and this one write exception.**
