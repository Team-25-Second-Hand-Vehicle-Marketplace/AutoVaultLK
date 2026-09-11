import {
  groqNormalizeStage,
  selectCandidates,
} from '../../../../src/workers/etl-worker/pipeline/normalize/groq-normalize.stage';
import { CONFIDENCE_FUZZY } from '../../../../src/workers/etl-worker/pipeline/normalize/dictionary-snapshot';
import type {
  NormalizedRow,
  StageContext,
} from '../../../../src/workers/etl-worker/pipeline/types';

const row = (confidence: number, rowNumber = 1): NormalizedRow => ({
  rowNumber,
  raw: {},
  normalized: { make: 'Toyota', model: 'Vitz' } as never,
  confidence,
});

const ctx = (threshold = 0.6) =>
  ({ config: { groqConfidenceThreshold: threshold } }) as never as StageContext;

describe('selectCandidates', () => {
  it('selects rows below the threshold', () => {
    expect(selectCandidates([row(0), row(0.5), row(1)], 0.6)).toHaveLength(2);
  });

  it('leaves a fuzzy dictionary hit alone', () => {
    // A fuzzy hit scores exactly 0.6 and the default threshold is 0.6. The
    // snapshot already vouched for that match with an ambiguity margin; paying
    // for an LLM call to second-guess it would be waste.
    expect(selectCandidates([row(CONFIDENCE_FUZZY)], 0.6)).toHaveLength(0);
  });

  it('honours a configured threshold', () => {
    expect(selectCandidates([row(0.9)], 1)).toHaveLength(1);
    expect(selectCandidates([row(0.9)], 0.5)).toHaveLength(0);
  });
});

describe('groqNormalizeStage', () => {
  const originalKey = process.env.GROQ_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  it('passes every row through when no key is configured', async () => {
    // The keyless path is required behaviour, not a stub: CI has no key, and a
    // dealer upload cannot fail because a third party is unreachable.
    delete process.env.GROQ_API_KEY;

    const rows = [row(0, 1), row(1, 2)];
    const result = await groqNormalizeStage.run(ctx(), rows);

    expect(result.rows).toEqual(rows);
    expect(result.outcome).toBe('SKIPPED');
  });

  it('reports how many rows would have been sent', async () => {
    // Visible in the stage log's metrics, so the value of enabling Groq is
    // measurable before anyone pays for it.
    delete process.env.GROQ_API_KEY;

    const result = await groqNormalizeStage.run(ctx(), [row(0), row(0.2), row(1)]);

    expect(result.metrics.candidates).toBe(2);
    expect(result.metrics.repaired).toBe(0);
  });

  it('skips cleanly when every row already resolved', async () => {
    process.env.GROQ_API_KEY = 'test-key';

    const result = await groqNormalizeStage.run(ctx(), [row(1), row(1)]);

    expect(result.outcome).toBe('SKIPPED');
    expect(result.metrics.candidates).toBe(0);
  });

  it('treats a whitespace-only key as unconfigured', async () => {
    process.env.GROQ_API_KEY = '   ';

    const result = await groqNormalizeStage.run(ctx(), [row(0)]);

    expect(result.outcome).toBe('SKIPPED');
  });

  it('never rejects a row', async () => {
    // validateRows is the single gate; low confidence is not invalidity.
    delete process.env.GROQ_API_KEY;

    const result = await groqNormalizeStage.run(ctx(), [row(0)]);

    expect(result.rejections).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('is registered as the GROQ_NORMALIZE stage', () => {
    expect(groqNormalizeStage.stage).toBe('GROQ_NORMALIZE');
  });
});
