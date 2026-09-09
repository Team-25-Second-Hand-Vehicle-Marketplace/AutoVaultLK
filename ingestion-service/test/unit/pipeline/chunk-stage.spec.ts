import { asChunkStage } from '../../../src/workers/etl-worker/pipeline/chunk-stage';
import {
  initialEnvelope,
  rawChunkKey,
  stageOutputKey,
} from '../../../src/workers/etl-worker/pipeline/envelope';
import type {
  StageContext,
  StageResult,
  StageRunner,
} from '../../../src/workers/etl-worker/pipeline/types';

type Row = { rowNumber: number; value: string };

const harness = (
  result: StageResult<Row> & { outcome?: string; error?: string },
  input: Row[] = [{ rowNumber: 1, value: 'a' }],
) => {
  const written = new Map<string, string>();
  const inner: StageRunner<Row[], typeof result> = {
    stage: 'PARSE_NORMALIZE',
    run: jest.fn().mockResolvedValue(result),
  };
  const rejections = { insertMany: jest.fn().mockResolvedValue(undefined) };

  const ctx = {
    store: {
      get: jest.fn(async () => Buffer.from(JSON.stringify(input))),
      put: jest.fn(async (key: string, body: string) => {
        written.set(key, body);
        return key;
      }),
    },
  } as never as StageContext;

  return { stage: asChunkStage(inner, { rejections }), inner, rejections, ctx, written };
};

const envelope = () => initialEnvelope('job-1', 'dealer-1', 3, 1);

describe('asChunkStage', () => {
  it('reads the input rows from the envelope key', async () => {
    const h = harness({ rows: [], rejections: [] });

    await h.stage.run(h.ctx, envelope());

    expect(h.ctx.store.get).toHaveBeenCalledWith(rawChunkKey('job-1', 3));
    expect(h.inner.run).toHaveBeenCalledWith(h.ctx, [{ rowNumber: 1, value: 'a' }]);
  });

  it('writes the output rows and returns a pointer, not the rows', async () => {
    // Step Functions caps a state payload at 256 KB; 250 normalized rows with
    // search_text is well past it, so only the key may cross a boundary.
    const rows = [{ rowNumber: 1, value: 'out' }];
    const h = harness({ rows, rejections: [] });

    const out = await h.stage.run(h.ctx, envelope());

    const key = stageOutputKey('job-1', 'PARSE_NORMALIZE', 3);
    expect(out.key).toBe(key);
    expect(JSON.parse(h.written.get(key) as string)).toEqual(rows);
    expect(JSON.stringify(out).length).toBeLessThan(1024);
  });

  it('writes each stage under its own prefix', async () => {
    // A failed run must leave every earlier stage's output intact, or an ASL
    // retry from the failing state has no input to read.
    expect(stageOutputKey('job-1', 'ENRICH', 0)).not.toBe(
      stageOutputKey('job-1', 'EMBED', 0),
    );
    expect(stageOutputKey('job-1', 'ENRICH', 0)).toContain('/enrich/');
  });

  it('persists rejections under the stage that produced them', async () => {
    // In process the orchestrator could accumulate across stages and write
    // once; across Lambdas that accumulator cannot exist, and a stage failing
    // after rejecting rows would lose them.
    const rejected = [{ rowNumber: 2, rawData: {}, reason: 'bad' }];
    const h = harness({ rows: [], rejections: rejected });

    await h.stage.run(h.ctx, envelope());

    expect(h.rejections.insertMany).toHaveBeenCalledWith('job-1', 'PARSE_NORMALIZE', rejected);
  });

  it('accumulates the rejected count across stages', async () => {
    const h = harness({ rows: [], rejections: [{ rowNumber: 2, rawData: {}, reason: 'bad' }] });

    const start = { ...envelope(), counts: { in: 5, out: 5, rejected: 2 } };
    const out = await h.stage.run(h.ctx, start);

    expect(out.counts.rejected).toBe(3);
  });

  it('reports in and out counts for the stage log', async () => {
    const h = harness(
      { rows: [{ rowNumber: 1, value: 'a' }], rejections: [] },
      [
        { rowNumber: 1, value: 'a' },
        { rowNumber: 2, value: 'b' },
      ],
    );

    const out = await h.stage.run(h.ctx, envelope());

    expect(out.counts).toMatchObject({ in: 2, out: 1 });
  });

  it('carries a DEGRADED outcome onto the envelope', async () => {
    // Without this the stage log shows a successful run and nobody learns the
    // embeddings are missing.
    const h = harness({ rows: [], rejections: [], outcome: 'DEGRADED', error: 'MiniLM down' });

    const out = await h.stage.run(h.ctx, envelope());

    expect(out.degraded).toBe('MiniLM down');
  });

  it('leaves degraded unset on a clean run', async () => {
    const h = harness({ rows: [], rejections: [], outcome: 'SUCCEEDED' });

    expect((await h.stage.run(h.ctx, envelope())).degraded).toBeUndefined();
  });

  it('carries SKIPPED without collapsing it into SUCCEEDED', async () => {
    // SKIPPED means the stage correctly did nothing — no Groq key, or no
    // candidates. Logging it as SUCCEEDED would claim the LLM had run.
    const h = harness({ rows: [], rejections: [], outcome: 'SKIPPED' });

    const out = await h.stage.run(h.ctx, envelope());

    expect(out.outcome).toBe('SKIPPED');
    expect(out.degraded).toBeUndefined();
  });

  it('preserves job, dealer and chunk identity', async () => {
    const h = harness({ rows: [], rejections: [] });

    const out = await h.stage.run(h.ctx, envelope());

    expect(out).toMatchObject({ jobId: 'job-1', dealerId: 'dealer-1', chunkId: 3 });
  });

  it('treats a null key as an empty batch rather than an error', async () => {
    // Load consumes its input and returns key: null; nothing runs after it,
    // but the shape must stay total.
    const h = harness({ rows: [], rejections: [] });

    const out = await h.stage.run(h.ctx, { ...envelope(), key: null });

    expect(h.ctx.store.get).not.toHaveBeenCalled();
    expect(out.counts.in).toBe(0);
  });

  it('does not modify the inner stage contract', async () => {
    // The inner stage still takes rows and returns { rows, rejections }; that
    // is what keeps its own unit tests meaningful.
    const h = harness({ rows: [], rejections: [] });

    await h.stage.run(h.ctx, envelope());

    expect(h.inner.run).toHaveBeenCalledWith(h.ctx, expect.any(Array));
  });
});

describe('envelope keys', () => {
  it('pads chunk ids so keys sort in order', () => {
    expect([rawChunkKey('j', 10), rawChunkKey('j', 2)].sort()).toEqual([
      rawChunkKey('j', 2),
      rawChunkKey('j', 10),
    ]);
  });

  it('slugs the stage name to match the src/lambda directory', () => {
    expect(stageOutputKey('j', 'PARSE_NORMALIZE', 0)).toContain('/parse-normalize/');
    expect(stageOutputKey('j', 'GROQ_NORMALIZE', 0)).toContain('/groq-normalize/');
  });

  it('starts a chunk pointing at the raw split output', () => {
    expect(initialEnvelope('j', 'd', 1, 42)).toEqual({
      jobId: 'j',
      dealerId: 'd',
      chunkId: 1,
      key: rawChunkKey('j', 1),
      counts: { in: 42, out: 42, rejected: 0 },
    });
  });
});
