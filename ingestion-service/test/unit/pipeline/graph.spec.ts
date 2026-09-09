import {
  ALL_STAGES,
  CHUNK_STAGES,
  FILE_STAGES,
  FINALIZE_STAGES,
  stageSlug,
} from '../../../src/workers/etl-worker/pipeline/graph';

/**
 * The graph is declared once and consumed by two executors — LocalOrchestrator
 * in process and a Step Functions state machine in AWS. These tests pin the
 * declaration itself; the ASL definition is checked against it separately once
 * that file exists.
 */
describe('pipeline graph', () => {
  it('runs the whole-file stages before any fan-out', () => {
    expect(FILE_STAGES).toEqual(['VALIDATE_FILE', 'SPLIT_CHUNKS']);
  });

  it('orders the chunk stages so each has what it needs', () => {
    // Order is load-bearing. GROQ_NORMALIZE needs the confidence
    // PARSE_NORMALIZE assigns; VALIDATE_ROWS must see a Groq repair before
    // gating; ENRICH must precede EMBED because buildSearchText reads
    // specs.body_type, and a row embedded before enrichment produces different
    // text from the manual path (FR-22.1).
    expect(CHUNK_STAGES).toEqual([
      'PARSE_NORMALIZE',
      'GROQ_NORMALIZE',
      'VALIDATE_ROWS',
      'ENRICH',
      'EMBED',
      'LOAD',
    ]);
  });

  it('ends the chunk chain with LOAD', () => {
    // Nothing consumes Load's output rows, which is why its envelope carries a
    // null key.
    expect(CHUNK_STAGES[CHUNK_STAGES.length - 1]).toBe('LOAD');
  });

  it('enriches before embedding', () => {
    expect(CHUNK_STAGES.indexOf('ENRICH')).toBeLessThan(CHUNK_STAGES.indexOf('EMBED'));
  });

  it('gates after the LLM fallback, not before', () => {
    expect(CHUNK_STAGES.indexOf('GROQ_NORMALIZE')).toBeLessThan(
      CHUNK_STAGES.indexOf('VALIDATE_ROWS'),
    );
  });

  it('finalizes after the map completes', () => {
    expect(FINALIZE_STAGES).toEqual(['AGGREGATE', 'NOTIFY']);
  });

  it('lists every stage exactly once', () => {
    expect(new Set(ALL_STAGES).size).toBe(ALL_STAGES.length);
  });

  it('slugs stage names to match the src/lambda directories', () => {
    // Both the Lambda directory names and the ASL state names derive from
    // this, so a stage has exactly one spelling.
    expect(stageSlug('PARSE_NORMALIZE')).toBe('parse-normalize');
    expect(stageSlug('LOAD')).toBe('load');
    expect(stageSlug('PROCESS_IMAGES')).toBe('process-images');
  });
});
