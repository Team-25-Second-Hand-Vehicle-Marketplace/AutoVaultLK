# ETL / Search Pipeline — Contradictions Found and Resolved

> Companion to `etl-pipeline.pdf` and `intelligent-search.pdf`. These PDFs are
> not edited directly; this document records where the two-flow reconstruction
> (`Project main two flows.pdf`, `Project main two flows (1).pdf`) diverged
> from or contradicted the source designs, and what was decided instead.
> Treat this as the current correction layer on top of both PDFs.

---

## 1. Enrichment derivations removed — `search_text` must drop them too

**The contradiction:** the reconstruction stated *"we will remove SIMPLE
DERIVATIONS of ENRICHING STEP, we don't need them"* while, on the same page,
still showing §12.5's output block containing `age`, `slug`, `price_band`,
`mileage_band`, and a `search_text` string built from `PREMIUM MODERATE` band
words — output that only exists because those derivations ran.

**Resolved:** derivations are fully removed. `age`, `slug`, `price_band`,
`mileage_band` are not computed, not stored, and not folded into
`search_text`. The `search_text` construction in §12.4 drops the
`price_band, mileage_band` line entirely — it is not replaced with an
inline computation; the band signal is gone from the vector.

**Consequence to carry forward:** the original ETL design's justification for
bands (*"buyers type 'cheap' and 'low mileage', not 'under 3 million'"*) no
longer applies. A buyer searching "cheap car" relies purely on whatever price
signal exists elsewhere in `search_text` (the raw `price` value, or the
description, if the dealer wrote "affordable"). This is an accepted tradeoff,
not an oversight — noted so it isn't rediscovered as a bug later.

---

## 2 / on `body_type` — moved to `specs`, not removed

**The contradiction:** `body_type` is a real ERD column derived via a
fallback chain (`BODY_TYPE_MAP` → seat/name inference → `"UNKNOWN"`) in the
original ETL design. Once "simple derivations" are removed, nothing
populates that column — yet Step E's zero-result relaxation, the LLM's
`allowed_fields`, and the whole `"sporting" → SPORTS` discussion all assume
`body_type` is a live, filterable column with data in it.

**Resolved:** `body_type` moves out of `VEHICLES` and into `specs` JSONB,
alongside `seats` (see item 6). It becomes a spec key like any other —
populated only when the dealer's CSV supplies it or when a per-vehicle-type
mapping resolves it, absent otherwise. The fallback-chain *lookup* is judged
worth keeping even though the arithmetic derivations (`age`, bands) are not;
this is a lookup with a real vocabulary behind it, not a computed number.

**Two follow-on changes this requires, not yet made:**

- **The ERD (`ERD.png`) still draws `body_type` as an `enum` column on
  `VEHICLES`.** It needs to be removed from the diagram or the diagram
  flagged as superseded on this point — the ERD is the schema source of
  truth other contributors (notably the auth-user-service developer) read
  from.
- **Step E's relaxation wording changes shape.** The original phrasing —
  *"a listing with `body_type = 'UNKNOWN'` becomes eligible again"* — assumed
  a stored sentinel value. Under JSONB, the key is more likely simply
  **absent** rather than set to `"UNKNOWN"`. Relaxation becomes "drop the
  `specs->>'bodyType'` condition from the query" rather than "widen the
  condition to include UNKNOWN." Functionally similar outcome, different
  mechanic — the query-builder logic for this step needs to reflect absence,
  not a sentinel.

---

## 3. Registration-number image join — blank and duplicate keys

**The contradiction:** the reconstruction dismissed the join-key risk
(§19 item 9 of the ETL design, still an open item there) with *"Not an issue
because our platform is a SECOND HAND VEHICLE MARKETPLACE"* — which answers
whether registration numbers generally *exist*, but not what happens when a
key is **blank** (unregistered imports) or **duplicated** (placeholder values
like `"TBA"` repeated across multiple rows in one upload).

**Resolved — duplicate keys:**

- Registration numbers are **normalized before matching** (case, whitespace,
  punctuation stripped) using the same normalization discipline as any other
  field — this also closes a separate, previously unstated gap: whether
  `CAR-1234`, `CAR 1234`, and `car1234` count as the same key. They now do.
- **Duplicate detection is an explicit check**, not an assumption of
  uniqueness. If more than one row in an upload shares the same normalized
  registration number, every row sharing that key is rejected.
- Duplicates route to **`rejected_records`** with an explicit reason (e.g.
  *"registration_number shared with N other rows in this upload — cannot
  reliably match images"*) — no new mechanism; this reuses the existing
  rejection pathway from §11 of the ETL design.
- **This check runs early — right after parsing, before the `Parallel`
  fan-out** — not inside `AggregateResults` where the two branches converge.
  The information needed (the CSV's registration_number column) is available
  immediately from the text rows alone; catching duplicates before
  `ProcessImages` runs avoids wasted image-processing work on rows already
  destined for rejection.
- The dealer resolves this manually (correcting the duplicate registration
  numbers in their source file) and re-uploads. This is not treated as a
  case for Groq — disambiguating which of several identically-keyed rows a
  photo belongs to is a data-integrity problem the dealer caused, not a
  language-understanding problem.

**Resolved — blank keys:** no attempt is made to distinguish "genuinely
unregistered" from "dealer forgot to fill it in" — that distinction can't be
determined reliably from the data alone. Instead, **every row with a blank
`registration_number` is flagged, unconditionally, every time.** The row is
not hard-rejected — it still proceeds through the pipeline and reaches
`PENDING_REVIEW` — but it carries an explicit flag (the same provenance
mechanism used elsewhere for AI-inferred fields, e.g. a `needsReview` marker
or an entry in the row's flagged-fields list) noting that no automated image
match could be attempted for this row.

The dealer sees this flag on the review dashboard and makes the call
themselves: confirm the vehicle is genuinely unregistered and approve it
without photos (or attach photos manually), or recognize the omission as
their own mistake, correct the CSV, and re-upload. No chassis-number
cross-check, no per-upload blank-rate heuristic — the system does not try to
infer intent; it simply surfaces every blank for a human decision, consistent
with the pipeline's governing principle that nothing inferred or ambiguous
reaches `LIVE` without a human seeing it first.

---

## 4. Two confidence formulas share a 0.6 threshold with no note that they differ

**The contradiction:** search computes row confidence as a **weighted blend**
— `weighted(coverage, has_make_model, has_numeric) − orphan_penalty` — while
ingestion computes it as the **minimum** across required fields, explicitly
*never* an average. Both gate at the same `0.6` threshold with no
acknowledgment that a weighted blend and a minimum are not comparable
quantities — `0.6` does not mean the same thing on both sides.

**Status: unresolved, not addressed in this round.** Recorded here so it
isn't lost. The original ETL design's own §8 argues ingestion should
arguably be *stricter* than search specifically because ingest errors are
permanent and search errors cost one query — but the reconstructed document
keeps `0.6` for both without engaging that argument. Needs a decision: either
document that the two `0.6`s are unrelated numbers that happen to coincide,
or deliberately tune them apart (e.g., a stricter ingest threshold, as the
original design already floats as an open option).

---

## 5. `specFilters` / `KNOWN_SPEC_KEYS` must be one shared vocabulary, not two

**The contradiction:** search introduced a `specFilters` output bucket keyed
against a `KNOWN_SPEC_KEYS` dictionary (e.g. `numDoors`, `airbags`,
`sunroof`). Ingestion independently produces a `specs` JSONB object via a
`switch (vehicle_type)` mapping (e.g. `doors`, `seats`, `driveType`). Nothing
in either document states these must be the same field names — if search's
dictionary says `numDoors` and ingestion's switch writes `doors`, then
`WHERE specs->>'numDoors' = ...` matches nothing, silently, with no error.
This is the exact failure mode the original ETL design (§13.2) already warns
about for make/model vocabulary drift, recurring here for spec keys.

**Resolved in principle, mechanism still to be built:** `KNOWN_SPEC_KEYS`
must be **one shared definition**, consumed by:

- the search-side parser (Stage 3 exact-match, and whichever field the
  Groq prompt's `allowed_spec_keys` block reads from),
- the ingestion-side `switch (vehicle_type)` mapping and its own Groq prompt
  (see item 6), and
- the SQL layer that builds `specs->>'key'` filter clauses on either side.

This is the same shared-definition requirement already flagged for the
fuel/transmission/body-type enums (see the "smaller things" note below) —
one mechanism, not three independently maintained lists. Not yet
implemented; flagged as a build item.

---

## 6. Ingest-side Groq prompt lacked spec-key context; `seats` moves to `specFilters`

**The contradiction:** search's Groq prompt (page 15 of the search
reconstruction) explicitly extends `allowedFields` to include
`KNOWN_SPEC_KEYS`, letting the LLM populate `specFilters` on the
low-confidence path. Ingestion's Groq prompt (page 8 of the ETL
reconstruction) only lists `Allowed makes / fuel / transmission` — no spec
keys — even though ingestion is the side that actually *writes* `specs`, and
the ETL design's own §9.2 example already shows Groq successfully extracting
a spec-shaped fact (`"full option"`) from free-text `description`. The
capability existed on the wrong side of the pipeline.

Separately: the search-side worked example put `seats: 4` under `filters`
(implying a real `vehicles.seats` column), but `seats` is not a column in the
ERD — it only appears inside the `CAR`/`VAN` branches of ingestion's
`switch (vehicle_type)`, i.e. it is a spec key.

**Resolved:**

- `seats` moves to `specFilters` on the search side, matching where it
  actually lives in the schema. The SQL example (`AND seats = $2`) becomes
  `AND specs->>'seats' = $2`, consistent with how `sunroof`/`airbags` are
  already handled.
- Ingestion's Groq prompt gains the same `allowed_spec_keys` context search
  already has, reading from the same shared `KNOWN_SPEC_KEYS` definition
  (item 5) — so a dealer's description mentioning `"7 seater"` or
  `"sunroof"` can be extracted into `specs` the same way `fuel: HYBRID` is
  already extracted from free text in the existing worked example.

---


---

## Summary table

| # | Issue | Status |
|---|---|---|
| 1 | Enrichment derivations vs. `search_text` still showing bands | **Resolved** — derivations and band words both removed |
| 2 | `body_type` derivation removed but still treated as a live column | **Resolved** — moved to `specs`; ERD and Step E wording still need updating |
| 3 | Registration-number join: blank vs. duplicate keys | **Resolved** — duplicates rejected with reason, checked pre-fan-out; blanks always flagged, dealer decides |
| 4 | Two incompatible confidence formulas sharing one 0.6 threshold | **Open** — not addressed this round |
| 5 | `specFilters` / `specs` vocabulary drift between search and ingest | **Resolved in principle** — shared `KNOWN_SPEC_KEYS` definition required, not yet built |
| 6 | Ingest Groq prompt missing spec-key context; `seats` in wrong bucket | **Resolved** — `seats` moved to `specFilters`; ingest prompt to gain `allowed_spec_keys` |
| — | Per-dictionary value drift (e.g. missing `CNG`) | **Resolved in principle** — one shared definition per dictionary, feeding both LLM contexts |
