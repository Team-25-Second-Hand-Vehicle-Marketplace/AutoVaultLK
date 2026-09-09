# Step Functions Migration — Plan

**Status: proposed, not started.** Approve before execution.

Moves the ETL from `LocalOrchestrator` to Step Functions with one Lambda per
stage, keeping `LocalOrchestrator` as the local and test path.

## Decisions taken (fixed inputs)

| # | Decision |
|---|---|
| 3 | Keep the copy + byte-identical parity test. No shared package. |
| 4 | **Path A** — chunk files stay in S3; only pointers cross ASL state boundaries. |
| — | **No consolidation.** Every stage is its own Lambda. |
| 6 | `LocalOrchestrator` stays as the local/integration path. |

---

## 1. The problem Path A creates

Today stages hand each other **in-memory arrays**:

```ts
const parsed    = await parseNormalizeStage.run(ctx, raw);
const groq      = await groqNormalizeStage.run(ctx, parsed.rows);
const validated = await validateRowsStage.run(ctx, groq.rows);
```

Under Path A each of those is a separate Lambda. Rows must land in S3 between
them, and only `{ jobId, chunkId, key }` crosses the state boundary — Step
Functions caps state payloads at **256 KB**, and 250 normalized rows with
`search_text` will exceed that.

Two consequences that are easy to miss:

**Rejections currently accumulate in memory.** `runChunk` collects them from
`validateRows` and from `load`, then writes once per chunk. Across Lambdas that
accumulator does not exist. Rejections must be persisted by the stage that
produces them, or handed forward in the envelope.

**The dictionary snapshot is loaded once per run and passed in context.** Across
Lambdas each invocation loads its own. At 16 ms that is acceptable, but it is
now per-stage-per-chunk rather than per-job: 5 stages × 20 chunks = 100 loads
instead of 1. Still under 2 seconds total, but worth knowing.

---

## 2. The envelope

One type, threaded through every state.

```ts
/** What crosses an ASL state boundary. Must stay far under 256 KB. */
export type ChunkEnvelope = {
  jobId: string;
  dealerId: string;
  chunkId: number;
  /** S3 key of this stage's OUTPUT rows. */
  key: string;
  /** Running totals, so aggregate needs no extra reads. */
  counts: { in: number; out: number; rejected: number };
  /** Set by a stage that degraded; the orchestrator logs it. */
  degraded?: string;
};
```

Roughly 200 bytes. A 50-chunk job's Map output is ~10 KB — comfortable.

**Rejections are written by the stage that produces them**, not accumulated.
`RejectedRecordRepository.insertMany` is already idempotent-safe to call more
than once per job, and this removes the cross-Lambda accumulator entirely.

---

## 3. Stage contract change

This is the core of the work. Every row stage gains an S3-aware wrapper while
its pure function stays untouched.

**Current** — stage takes rows, returns rows:

```ts
StageRunner<NormalizedRow[], StageResult<ValidatedRow>>
```

**Proposed** — a thin `ChunkStage` wraps it:

```ts
export type ChunkStage = {
  readonly stage: EtlStage;
  run(ctx: StageContext, envelope: ChunkEnvelope): Promise<ChunkEnvelope>;
};

export function asChunkStage<TIn, TOut>(
  inner: StageRunner<TIn[], StageResult<TOut>>,
  deps: { rejections: RejectionSink },
): ChunkStage;
```

`asChunkStage` does exactly four things:

1. read `envelope.key` from the object store
2. call `inner.run(ctx, rows)`
3. persist `result.rejections` through the sink
4. write `result.rows` to `staging/{jobId}/{stage}/chunk-{n}.json`, return a new
   envelope pointing at it

**Every existing stage keeps its current signature and its current tests.** The
pure functions are not rewritten — they are wrapped. That is what makes this
tractable and keeps the 412 unit tests meaningful.

`load` is the exception: it terminates the chain and writes no rows file. It
returns an envelope with `counts.out` set and no new key.

### Storage key layout

```
staging/{jobId}/chunk-000.json                  splitChunks output (raw rows)
staging/{jobId}/parse-normalize/chunk-000.json
staging/{jobId}/groq-normalize/chunk-000.json
staging/{jobId}/validate-rows/chunk-000.json
staging/{jobId}/enrich/chunk-000.json
staging/{jobId}/embed/chunk-000.json
```

Per-stage prefixes rather than overwriting: a failed run leaves the inputs of
every stage intact, which is what makes an ASL retry from the failing state
possible at all. S3 lifecycle expires `staging/` after 7 days.

---

## 4. Work breakdown

### S1 — Envelope + `asChunkStage` *(no AWS)*

- `pipeline/envelope.ts` — the type, key builders, `RejectionSink` interface
- `pipeline/chunk-stage.ts` — the wrapper
- `LocalOrchestrator.runChunk` rewritten to chain envelopes instead of arrays

**Verification:** all 412 unit tests still pass unchanged; the 25 integration
tests still pass. If either needs editing, the wrapper is wrong.

This step alone proves the design before any AWS work exists. **It is also the
riskiest step** — if the envelope shape is wrong, everything after it is built
on sand.

### S2 — AWS drivers *(no ASL yet)*

- `infrastructure/storage/s3-object-store.ts` — implements `ObjectStore`
- `infrastructure/queue/sqs-job-queue.ts` — implements `JobQueue`
- `StorageModule` / `QueueModule` stop throwing on `s3` / `sqs`
- New deps: `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/client-sqs`

**Note on `getStream`.** S3's `GetObject` returns a web stream in SDK v3;
`splitChunks` pipes it into `csv-parse` expecting a Node stream. Needs
`Readable.fromWeb`, and `LocalObjectStore` must be checked for the same shape.

**Verification:** `INGESTION_STORAGE_DRIVER=s3` against a real bucket, running
`run-pipeline.ts` end to end. Same 34/6 result as the local driver.

### S3 — Lambda handlers

13 files under `src/lambda/`, each ~15 lines:

```ts
// src/lambda/parse-normalize.ts
export const handler = async (envelope: ChunkEnvelope): Promise<ChunkEnvelope> =>
  runChunkStage(parseNormalizeStage, envelope);
```

A shared `lambda/bootstrap.ts` builds the context once per container: object
store, dictionary snapshot, repositories, TypeORM DataSource with
**`extra: { max: 1 }`** (a Lambda handles one invocation at a time; a pool of 5
is pointless and multiplies connections).

**Verification:** invoke each handler locally with a hand-written envelope and
a real S3 key.

### S4 — The state machine

`infrastructure/step-functions/etl-state-machine.asl.json`

```
ValidateFile → SplitChunks → Map(chunks, MaxConcurrency: 10)
                               └─ ParseNormalize → GroqNormalize
                                  → ValidateRows → Enrich → Embed → Load
                             → Aggregate → Notify
```

- **Retry** on `Load`: 2 attempts, exponential backoff with jitter — replaces
  the hand-rolled loop in `LocalOrchestrator.load`
- **Retry** on every state for `Lambda.TooManyRequestsException` and
  `Lambda.ServiceException`
- **Catch** on the per-chunk chain → a `ChunkFailed` pass state, so one chunk's
  failure does not fail the Map. **This is what produces `PARTIAL`** and is the
  single most important thing to get right in the ASL.
- **Catch** at the top level → `MarkJobFailed`

`ResultPath` and `OutputPath` must be set carefully so a state's output replaces
the envelope rather than nesting it.

### S5 — Drift guard

Nothing enforces that the ASL graph and `LocalOrchestrator` stay equivalent.
They will drift, and the failure is silent: local tests pass, deployed pipeline
skips a stage.

`pipeline/graph.ts` — a single declaration both consume:

```ts
export const CHUNK_STAGES = [
  'PARSE_NORMALIZE', 'GROQ_NORMALIZE', 'VALIDATE_ROWS',
  'ENRICH', 'EMBED', 'LOAD',
] as const;
```

Plus a test asserting the ASL's Map iterator states match `CHUNK_STAGES` in
order. Cheap, and the only thing standing between you and a silent divergence.

### S6 — Connection pooling *(do not skip)*

Under Lambda, **each concurrent execution is its own container with its own
pool.** `MaxConcurrency: 10` × `max: 5` = **50 connections per job**. Three
dealers uploading at once is 150. Postgres `max_connections` defaults to 100.

Three changes, all needed:

1. `extra: { max: 1 }` when `AWS_LAMBDA_FUNCTION_NAME` is set
2. **RDS Proxy** in front of the database — already listed as deferred in the
   plan; it stops being optional here
3. `INGESTION_MAX_CONCURRENCY` becomes the Map's `MaxConcurrency`, sized against
   the proxy's limit rather than guessed

**This is the item most likely to take production down, and the least visible
in testing** — it only appears under concurrent load.

### S7 — Packaging

- **Embed Lambda: container image.** The ONNX model is ~90 MB; a layer caps at
  250 MB unzipped and the model plus `@xenova/transformers` plus deps will not
  fit comfortably. The Dockerfile already targets
  `public.ecr.aws/lambda/nodejs:22`.
- **Other 12: zip.** Small and fast to cold-start.
- Memory: embed 2048 MB (inference is CPU-bound and Lambda scales CPU with
  memory), others 512 MB.
- Timeouts: embed 300 s, load 120 s, others 60 s.

### S8 — Terraform

Out of scope for this plan unless you want it now. The state machine, 13
functions, IAM roles, S3 bucket with lifecycle, SQS queue and RDS Proxy are all
straightforward but substantial. **Recommend a separate plan.**

---

## 5. Sequencing

```
S1  envelope + wrapper          ← proves the design, no AWS
S2  S3 + SQS drivers            ← ports already exist
S3  13 Lambda handlers          ← thin, mechanical
S4  ASL state machine
S5  drift guard                 ← do alongside S4, not after
S6  pooling + RDS Proxy         ← before any load testing
S7  packaging
S8  Terraform                   ← separate plan
```

**S1 is the gate.** If the 412 unit tests and 25 integration tests still pass
after S1 with no edits, the design is sound and everything after it is
mechanical. If they need editing, stop and reconsider the envelope shape.

---

## 6. What does not change

- **Every stage's pure function.** They are wrapped, not rewritten.
- **All 412 unit tests.** They test the inner stages.
- **The stage contract's core rule** — a stage never throws because a row is
  bad. ASL `Catch` handles infrastructure; `rejections` still handles data.
- **`LocalOrchestrator`.** It becomes the local and integration path, chaining
  the same envelopes through the same wrappers.
- **`MarketplaceVehiclesWriteAdapter`.** Still the one cross-schema write, now
  inside the load Lambda.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **ASL/orchestrator drift** | S5's shared graph declaration + test |
| **Connection exhaustion** | S6 — RDS Proxy and `max: 1`, both required |
| **Chunk size × payload** | Envelope is ~200 bytes; chunk size no longer constrains ASL, so 250 stays valid |
| **Embed cold start** | Container image; consider provisioned concurrency if latency matters |
| **S3 eventual consistency** | Strongly consistent since Dec 2020 — no longer a concern |
| **Rejection double-write on retry** | A retried stage re-inserts its rejections. Needs either a delete-by-(job, stage) before insert, or accepted duplicates. **Open question — decide in S1.** |

---

## 8. Open questions for you

1. **Rejection idempotency on retry** (risk table, last row). Cleanest is
   `DELETE FROM rejected_records WHERE upload_job_id = $1 AND stage = $2`
   before each insert, which needs a `stage` column added to that table. Adds a
   migration. Acceptable?

2. **Terraform now or later?** S8 is roughly the same size as S1–S7 combined.

3. **Does `LocalOrchestrator` keep per-stage S3 writes locally?** Simplest is
   yes — identical code path, and `LocalObjectStore` makes it cheap. It does
   mean local runs write ~6× more files to `.storage/`.

---

## 9. Estimate

| Step | Size |
|---|---|
| S1 envelope + wrapper | medium — the design work is here |
| S2 AWS drivers | small |
| S3 handlers | small, mechanical |
| S4 ASL | medium — `ResultPath` and `Catch` need care |
| S5 drift guard | small |
| S6 pooling | small in code, needs infrastructure |
| S7 packaging | small |
| S8 Terraform | large — separate plan |
