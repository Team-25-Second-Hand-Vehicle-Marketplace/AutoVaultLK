Builds the ETL pipeline that turns a dealer's CSV into rows in
`marketplace.vehicles` — dictionary resolution, normalization, validation,
enrichment, embedding, the cross-schema write and the orchestrator that runs
them.

Phase 0 (#77) landed the foundations; this is the pipeline itself.

## What it does

```
Dealer CSV ──▶ validateFile ──▶ splitChunks
                                     │  fan out, bounded concurrency 10
                                     ▼
      parseNormalize → groqNormalize → validateRows → enrich → embed → load
                                     │
                                     ▼
                        COMPLETED / PARTIAL / FAILED
```

Rejected rows land in `ingestion.rejected_records` with a reason; every stage
writes `ingestion.etl_stage_logs`.

## The rules that shape it

**A stage never throws because a row is bad.** Bad rows travel as `rejections`
alongside `rows`; only infrastructure failure throws. That single rule is why
`PARTIAL` status and per-row rejections fall out of the design rather than
needing special-casing at every level. `validateFile` is the one exception — a
file with no header row has no rows to reject individually.

**Bulk listings must be indistinguishable from manual ones.** `embed` passes
exactly the 10 fields `ListingSearchIndexService` passes, in the same order,
from the same shared module. Two tests guard this: one asserts our copy of
`normalize-embed` is byte-identical to marketplace's, the other builds the
manual path's search text independently and asserts equality. Without both,
bulk stock lands in a different region of vector space and ranks badly forever
— no error, no failing test, no log line (FR-22.1 / NFR-26.1, plan-b §9A).

**One cross-schema writer.** `MarketplaceVehiclesWriteAdapter` is the only
class in the platform that writes `marketplace.*`. ADR-002's exception is only
defensible while confined; an integration test asserts the role holds no
DELETE, so the boundary is checked rather than assumed.

## Decisions worth reviewing

| Decision | Why |
|---|---|
| Fuzzy matches need a 0.05 margin over the runner-up | `Corola` at 0.72 vs `Corolla` and 0.71 vs `Corsa` would otherwise be a coin flip written into a dealer's inventory. Below the margin it falls to Groq. |
| Row confidence is the **minimum**, not the mean | A row whose make resolved exactly but whose model did not is wrong where it matters; averaging hides that behind four confident cells. |
| `"3,5"` → null, not 35 | European decimal or a typo. Stripping the comma is a tenfold error in a price. |
| Every Groq value re-resolved through the dictionary | A prompt is a request, not a constraint. An invented pair is one no search facet could ever match. |
| Load batches, then isolates on conflict | A batch INSERT aborts entirely on the first violation — one duplicate would lose 249 good rows. |
| Counts read from the database on finish | A resumed run loads nothing new; tallying only this run downgraded a COMPLETED job to FAILED. |

## Tests

- **26 suites / 396 unit tests** — `npm run test:ci`
- **25 integration tests** against live Postgres — `npm run test:integration`

Integration tests are separate because they need a database, and they skip
themselves when none is reachable, so `test:ci` stays green without Docker. CI
starts a Postgres service and runs both.

They cover what no unit test can: that the partial-index `ON CONFLICT` target
actually matches (a mismatched predicate raises at runtime, not review), that
pgvector accepts the `::vector` cast at 384 dimensions, that
`trg_vehicles_search_vector` fires, and that a re-run inserts nothing new —
including rows with a null registration number, which miss both partial indexes
and have no database-level protection at all.

## Verified end to end

`node dist/tools/run-pipeline.js test/fixtures/e2e-mixed.csv` against a live
database: 40 rows → 34 loaded, 6 rejected, `PARTIAL`. All rows
`PENDING_REVIEW`, zero null `search_vector`, zero null `embedding`, zero null
`dealer_id`. Re-running changes nothing.

The Groq path was checked against the real API: `Toyota Motor Corporation
Japan` and `Merc` both repaired to canonical makes — neither reachable by
trigram matching — while `Lamborghini` was refused by the whitelist. Rows that
already resolve fuzzily are never sent, so the call is only made where it adds
something.

## For Dev B

`HANDOVER.md` is updated. It previously said the pipeline did not exist and
that a job showing `FAILED` meant their code worked; that placeholder is gone,
so the advice would have had them debugging working code.

- `MarketplaceVehiclesWriteAdapter` is exported from `IngestionModule`
- `TEMPLATE_HEADER` in `csv-contract.ts` answers the B5 template question
- `run-pipeline.ts` is the reference for what B1's handler must do

## Not in this PR

- `MarketplaceVehicleImagesWriteAdapter` — B3 needs it; the signature is mine
  to add when Dev B asks
- The model-parity SQL check (cosine distance between a manual and a bulk
  listing) — needs B1's endpoint to exist
- The 13 `src/lambda/*` directories stay empty until the deployment phase

🤖 Generated with [Claude Code](https://claude.com/claude-code)
