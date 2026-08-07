# SRS Revision Instructions

> **Purpose of this file:** a worked list of changes to apply to the attached
> SRS document ("Second-Hand Vehicle Marketplace with Intelligent Search and
> Automated Inventory Processing"). Apply each item below directly to the
> document. Where exact replacement text is given, use it verbatim unless it
> conflicts with content elsewhere in the document not covered here — in that
> case, flag the conflict rather than silently picking one side.
>
> Items are grouped by severity: **Fix** (objective errors — duplicate
> numbers, factual mistakes, formatting), **Update** (content that no longer
> matches the actual system as built), **Add** (real, implemented behavior
> that currently has no requirement covering it), **Polish** (structural/
> cosmetic). Do the Fix and Update groups first — they're higher-confidence
> and lower-judgment than the Add group.

---

## Project Overview

> Read this before applying any change below — it's the context that makes
> the rest of this file's instructions legible without access to the
> original design conversation.

**What the system is.** A cloud-native, second-hand vehicle marketplace for
Sri Lanka. Dealers bulk-upload their inventory as a CSV plus a ZIP of
images; an automated pipeline validates, corrects, and enriches that data
before it becomes searchable. Buyers find vehicles either through
conventional filters or by typing a natural-language query (e.g. *"automatic
SUV under 20 million, low mileage"*), which the system parses into
structured filters and a semantic-similarity ranking. Three roles exist:
Buyer, Dealer, Administrator (plus unauthenticated Guest browsing).

**Why the architecture looks the way it does.** Two problems shaped almost
every design decision in this document:

1. **Dealer data is messy, but predictably so.** Real CSV exports contain
   typos ("Toyata"), abbreviations ("95k", "auto"), and inconsistent
   formatting. Fixing this by hand doesn't scale, and sending every row to
   an LLM is slow and wasteful. So the system uses a **rules-first,
   AI-fallback** pattern in two places: the ETL pipeline (normalizing
   dealer-supplied data) and the search engine (parsing buyer queries).
   Deterministic rules (dictionary lookups, regex, trigram fuzzy matching)
   handle the large majority of cases for free; only genuinely ambiguous
   input is escalated to the Groq AI API, and every AI output is validated
   against a whitelist before it can affect the database — an AI-invented
   filter value must never silently produce a zero-result query.
2. **Vehicles have wildly different attributes by type.** A car has a body
   type and seat count; a motorcycle doesn't. Rather than a relational
   column per possible attribute (mostly-empty, and requiring a migration
   for every new vehicle category), category-specific attributes live in a
   JSONB `specs` column, while universal fields (make, model, year, price,
   dealer) remain relational for indexing and filtering.

**How the backend is organized.** Five independently deployable NestJS
services — Auth & User, Marketplace, Ingestion & ETL, Admin, Notification —
each deployed as containerized AWS Lambda functions behind API Gateway.
They share one PostgreSQL (RDS) instance for operational simplicity, but
isolation between services is enforced at the database level: each service
owns a separate schema and connects with its own least-privilege role.
Cross-schema reads are allowed only where a foreign key already justifies
the relationship (e.g. a vehicle listing referencing its dealer); writes
never cross schema boundaries except one explicitly documented exception —
see the rewritten §3.10 in Group 2 for the exact rule and its rationale.

**Where AI actually sits in the system, and where it deliberately doesn't.**
Groq AI (an LLM) is used only as a *fallback interpreter* in two bounded
spots: (a) inside the ETL pipeline, to normalize a dealer's CSV row when
deterministic rules score it as ambiguous, and (b) inside search, to parse
a natural-language buyer query when the rule-based parser's confidence
score falls below threshold. In both cases the AI's output is treated as
untrusted input — validated against a schema/whitelist before merging —
and the system is designed to keep functioning with reduced accuracy (not
fail) if Groq is unavailable or rate-limited. This is why Group 4 below
reframes Groq availability as a mitigated risk rather than a bare
assumption: the fallback behavior is a real, engineered part of the system,
not a gap.

**What this means for revising the SRS.** The requirements below aren't
speculative additions — each one in Group 3 describes behavior that has
already been designed and, in most cases, implemented and verified against
a running system (the database schema, the isolation model, the ETL
review gate, the dealer verification flow). The goal of this revision pass
is to bring the SRS into alignment with what actually exists, not to
propose new scope.

---

## Group 1 — Fix (objective errors)


### 1.4 NFR-33 gives an incorrect technical justification

Current text: *"The Ingestion & ETL pipeline shall be orchestrated via AWS
Step Functions rather than a single monolithic Lambda worker to bypass the
15-minute execution timeout."*

This is factually wrong. AWS Step Functions does **not** bypass or extend
the Lambda execution timeout — each individual Lambda invocation inside a
Step Functions state machine is still capped at 15 minutes. What Step
Functions actually provides, and what should replace this justification:

**Replace with:**
> NFR-33: The Ingestion & ETL pipeline shall be orchestrated via an AWS Step
> Functions state machine rather than a single monolithic Lambda worker, so
> that large uploads are processed as many short-lived, independently
> retryable Lambda invocations. This provides declarative per-stage retry
> policies, automatic fan-in after parallel chunk processing, and
> independent memory sizing per stage — none of which require, or provide,
> any change to the individual 15-minute Lambda execution limit.

### 1.5 NFR-12 duplicates FR-24

Both state the same fallback requirement (filter/trigram search when
semantic ranking is unavailable) almost verbatim. Keep the functional
requirement (FR-24) as the source of truth; replace NFR-12 with a
cross-reference:

**Replace NFR-12 with:**
> NFR-12: See FR-24 — the filter/trigram fallback is a functional
> requirement of the search engine, not a separate non-functional
> constraint.

---

## Group 2 — Update (content that no longer matches the implemented system)

### 2.1 Section 3.10 Database Requirements — rewrite entirely

The current §3.10 describes a database design that does not match what has
been built, migrated, and verified. Replace the entire section with:

> ### 3.10 Database Requirements
>
> A single Amazon RDS PostgreSQL instance, extended with the `pgvector` and
> `pg_trgm` extensions, serves all backend services. Isolation between
> services is enforced at the schema and role level, not merely by
> convention:
>
> - **Five schemas**, one per backend service: `auth`, `marketplace`,
>   `ingestion`, `notification`, `admin`.
> - **Five least-privilege PostgreSQL roles**, one per service, each holding
>   full read/write access only to its own schema.
> - **Cross-schema reads are permitted only where a foreign-key relationship
>   already justifies them** — for example, `marketplace.vehicles.dealer_id`
>   references `auth.users.id`, so marketplace-service holds read-only
>   access to `auth.users`.
> - **Cross-schema writes are forbidden with exactly one documented
>   exception**: the Ingestion & ETL pipeline's load stage writes directly to
>   `marketplace.vehicles` and `marketplace.vehicle_images`, because routing
>   this write through a synchronous API call would undermine the
>   pipeline's connection-pool concurrency design. This exception is scoped
>   to `INSERT`/`UPDATE` only; the ETL pipeline is never granted `DELETE` on
>   marketplace tables.
> - The Admin Service holds read-only access across all other schemas to
>   support cross-cutting reporting and dashboards; it performs no direct
>   writes outside its own `admin` schema — administrative actions that
>   modify another service's data are performed through that service's API.
>
> **Core tables by schema:**
>
> | Schema | Tables |
> |---|---|
> | `auth` | `users`, `dealer_profiles`, `refresh_tokens` |
> | `marketplace` | `vehicles`, `vehicle_images`, `favourites`, `search_queries`, `vehicle_dictionaries` |
> | `ingestion` | `upload_jobs`, `rejected_records`, `etl_stage_logs` |
> | `notification` | `notifications` |
> | `admin` | `audit_logs` |
>
> `vehicles` stores universal fields (make, model, year, price, mileage,
> dealer, status) as relational columns, and stores type-specific and
> variable specifications (body type, seat count, and other attributes that
> differ by vehicle category) in a `specs` JSONB column — see FR-15 for the
> rationale. `vehicle_dictionaries` is a controlled vocabulary table
> supporting fuzzy (trigram) correction of dealer- and buyer-supplied make
> and model text.
>
> Listing embeddings are stored as a fixed-length `vector(384)` column
> matching the output dimensionality of the `all-MiniLM-L6-v2` model.
> Database backups rely on RDS automated snapshots.

### 2.2 FR-15 — restore the concrete polymorphic-specs example

Current FR-15 states the JSONB approach without illustrating why it's
necessary. Replace with:

> FR-15: Each listing shall store core relational data (make, model, year,
> price, mileage, dealer, status) as relational columns, and shall store
> category-specific specifications in a JSONB `specs` column. This is
> necessary because required attributes vary by vehicle type — for example,
> a car has a body type and seat count that a motorcycle does not, and a
> motorcycle has attributes (e.g. engine displacement class) that a van does
> not — and a fixed relational schema would otherwise require either a
> sparse table with many always-null columns or a schema migration for
> every new vehicle category.

### 2.3 FR-35 — correct the image-matching mechanism

Current text ("based on filename or manifest metadata") does not reflect
the actual matching rule. Replace with:

> FR-35: The system shall match uploaded images to the correct listing
> using the vehicle's registration number, normalized for case and
> formatting before comparison.
>
> FR-35.1: Rows whose registration number duplicates another row within the
> same upload shall be rejected to the rejected-records table with an
> explicit reason, since a duplicate key makes automated image matching
> unreliable.
>
> FR-35.2: Rows with a blank registration number shall not be rejected —
> unregistered vehicles (e.g. recent imports) are a legitimate case — but
> shall be accepted without an automated image match and flagged for the
> Dealer to resolve manually during review.

---

## Group 3 — Add (implemented/designed behavior with no requirement)

### 3.1 Dealer review gate before a listing goes live

Add to §3.1.3 (Ingestion & ETL Service), after the existing load/aggregate
requirements:

> FR-42.1: Listings produced by the ETL pipeline shall be persisted with
> `PENDING_REVIEW` status. No ETL-loaded listing shall become publicly
> visible (`LIVE`) until the owning Dealer explicitly approves it.
>
> FR-42.2: The Dealer-facing review interface shall indicate which fields
> on a `PENDING_REVIEW` listing were inferred by the Groq AI normalization
> step, along with the model's stated reasoning for that inference, and
> shall present rows in ascending order of normalization confidence score
> so the least-certain rows are reviewed first.

### 3.2 Alias-promotion / vocabulary learning loop

Add to §3.1.2 (Marketplace Service), after FR-21.3:

> FR-21.4: The system shall log every natural-language query's unresolved
> tokens and any corrections applied by the Groq AI fallback. Corrections
> that recur with sufficient frequency shall be promoted into the
> vehicle-dictionary vocabulary, so that subsequent occurrences of the same
> correction resolve through the deterministic rule-based parser without
> requiring a further Groq AI API call.

### 3.3 Dealer verification flow (individual vs. business)

Add to §3.1.1 (Auth & User Service), replacing or supplementing the current
FR-02/FR-09 pair:

> FR-02: New Dealer registrations shall require the Dealer to declare a
> dealer type of either Individual or Business, and shall be placed in a
> `PENDING` verification state requiring Administrator approval before
> activation.
>
> FR-02.1: A Business-type Dealer shall be required to supply a business
> registration number and to upload supporting verification documents
> (e.g. business registration certificate); an Individual-type Dealer shall
> not be required to supply a business registration number.
>
> FR-02.2: The system shall record which Administrator approved or rejected
> a Dealer's verification, and the timestamp of that decision.
>
> FR-09: The system shall allow Administrators to review a pending Dealer's
> declared type and uploaded verification documents, and to approve or
> reject the registration, triggering an automated email notification of
> the decision.
>
> *(If FR-02/FR-09 already exist elsewhere in the numbering, merge these
> into the existing requirements rather than duplicating the numbers — do
> not create a second FR-02.)*

### 3.4 Cold-start allowance for natural-language search latency

Amend NFR-09:

> NFR-09: Average API response time shall be under 500 ms for CRUD/browse
> endpoints. For natural-language search, average response time on a warm
> Lambda invocation shall be under 2 s; a cold-start invocation (which must
> load the ~90 MB embedding model into memory) may take longer, and this
> distinction shall be measured and reported separately rather than
> blended into a single average.

---

## Group 4 — Reframe (not wrong, but understates what was actually designed)

### 4.1 §2.5 Assumptions — Groq AI free-tier sufficiency

Current text lists Groq's free-tier limits being sufficient as a bare
**assumption** with no stated mitigation, which understates the actual
design — the system has explicit, engineered fallback paths for exactly
this failure mode (both the search engine and the ETL pipeline degrade to
rule-based-only processing if Groq is unavailable or rate-limited, per
NFR-34 and FR-24).

**Action:** move this out of the Assumptions list and into a short risk
statement, e.g.:

> **Risk — Groq AI rate limits.** The hybrid search engine and ETL pipeline
> both call the Groq AI free tier for low-confidence natural-language
> parsing and row normalization respectively. If free-tier request or token
> limits are exhausted, both subsystems are designed to degrade gracefully:
> search falls back to rule-based parsing and trigram/filter-only results
> (FR-24), and ETL normalization proceeds using only the deterministic
> rule-based parser, with affected rows flagged for manual Dealer review
> rather than the pipeline failing (NFR-34). The system does not depend on
> Groq availability to remain functional, only to reach its highest
> accuracy on ambiguous inputs.

---

## Group 5 — Polish (cosmetic / structural, low risk, do last)

- **Title page:** replace the literal placeholder text `<Subsystem or
  Feature>` with the actual system name, or remove the "For..." line
  entirely if this SRS covers the whole system rather than one subsystem.
- **§1.5 Overview:** currently empty template instruction text. Replace
  with 3–5 sentences summarizing the structure of the rest of the document
  (what §2 covers, what §3 covers, how requirements are organized by
  service).
- **Remove template/RUP boilerplate** at the very top of the document (the
  blue-italics Microsoft Word instructions about customizing fields) —
  this should never appear in a document being submitted or reviewed.
- **Confirm diagram placement.** An earlier draft of this document had
  bracketed diagram placeholders (`[system architecture diagram]`,
  `[hybrid search flow diagram]`, `[ETL pipeline flow diagram]`,
  `[database entity relationship diagram]`) that do not appear in the
  current version. Confirm whether these were embedded as actual images
  (acceptable) or simply deleted without being replaced (a gap — these
  diagrams were called out as needed and should either be embedded or the
  document should note where they will be added).

---

## Do not change without asking

- **Do not invent new functional requirements beyond what's listed above.**
  Everything in Group 3 reflects behavior that has actually been designed
  and, in most cases, implemented and verified against a live database in
  this project — it is not speculative scope expansion.
- **Do not renumber FR/NFR IDs beyond what Group 1 explicitly requires.**
  If applying Group 1.1's renumbering causes a cascade that would relabel
  many other requirements, list the full old-ID → new-ID mapping as a
  table so it can be reviewed before committing to it, rather than
  silently reflowing every number in the document.
- **Do not alter §3.11 (Licensing/Legal) or §3.12 (Applicable Standards)** —
  out of scope for this revision pass.
