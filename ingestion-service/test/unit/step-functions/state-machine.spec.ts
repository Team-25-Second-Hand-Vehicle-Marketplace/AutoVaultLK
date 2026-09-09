import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHUNK_STAGES,
  FILE_STAGES,
  stageSlug,
} from '../../../src/workers/etl-worker/pipeline/graph';

type AslState = {
  Type: string;
  Next?: string;
  End?: boolean;
  Retry?: { ErrorEquals: string[]; MaxAttempts?: number; JitterStrategy?: string }[];
  Catch?: { ErrorEquals: string[]; Next: string; ResultPath?: string }[];
  Parameters?: { FunctionName?: string };
  OutputPath?: string;
  ItemProcessor?: { StartAt: string; States: Record<string, AslState> };
  ItemsPath?: string;
  ResultPath?: string;
  MaxConcurrency?: number;
  Default?: string;
};

const asl = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../src/infrastructure/step-functions/etl-state-machine.asl.json'),
    'utf8',
  ),
) as { StartAt: string; States: Record<string, AslState> };

const map = asl.States.ProcessChunks;
const iterator = map.ItemProcessor as NonNullable<AslState['ItemProcessor']>;

/** Walks a Next chain from a starting state, returning the names in order. */
const chain = (states: Record<string, AslState>, start: string): string[] => {
  const names: string[] = [];
  let current: string | undefined = start;

  while (current) {
    names.push(current);
    current = states[current]?.Next;
  }

  return names;
};

/** PascalCase state name for a stage: PARSE_NORMALIZE becomes ParseNormalize. */
const stateName = (stage: string): string =>
  stageSlug(stage)
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');

/**
 * The drift guard.
 *
 * Two executors run this pipeline — LocalOrchestrator in process and this
 * state machine in AWS — and nothing else would stop them diverging. The
 * failure mode is silent and in the worst direction: local tests pass while
 * the deployed pipeline skips a stage, and the first person to notice is a
 * dealer whose vehicles have no embeddings.
 */
describe('ETL state machine', () => {
  it('is valid JSON with a start state', () => {
    expect(asl.StartAt).toBe('ValidateFile');
    expect(Object.keys(asl.States).length).toBeGreaterThan(0);
  });

  describe('matches pipeline/graph.ts', () => {
    it('runs the whole-file stages before the fan-out, in order', () => {
      const expected = FILE_STAGES.map(stateName);

      expect(chain(asl.States, asl.StartAt).slice(0, expected.length)).toEqual(expected);
    });

    it('runs every chunk stage inside the Map, in order', () => {
      // The assertion that matters: adding a stage to CHUNK_STAGES without
      // adding it here fails the build rather than a dealer's upload.
      expect(chain(iterator.States, iterator.StartAt)).toEqual(CHUNK_STAGES.map(stateName));
    });

    it('points every stage state at its own Lambda', () => {
      for (const stage of CHUNK_STAGES) {
        const fn = iterator.States[stateName(stage)].Parameters?.FunctionName ?? '';

        // Terraform substitutes the real ARN for the placeholder.
        expect(fn).toContain(`${stateName(stage)}FunctionArn`);
      }
    });

    it('has a handler file for every state it invokes', () => {
      for (const stage of [...FILE_STAGES, ...CHUNK_STAGES]) {
        const path = resolve(__dirname, `../../../src/lambda/${stageSlug(stage)}.ts`);
        expect(existsSync(path)).toBe(true);
      }
    });

    it('has a handler for the terminal failure path', () => {
      expect(existsSync(resolve(__dirname, '../../../src/lambda/mark-job-failed.ts'))).toBe(true);
    });
  });

  describe('chunk isolation', () => {
    it('catches a failed chunk on the Map rather than failing the job', () => {
      // THE correctness requirement. Without this Catch one bad chunk fails
      // the whole execution and a dealer loses 399 good vehicles to one bad
      // row — the opposite of what PARTIAL exists for.
      const caught = map.Catch?.find((c) => c.ErrorEquals.includes('States.ALL'));

      expect(caught).toBeDefined();
      expect(caught?.Next).toBe('Aggregate');
    });

    it('does not let the iterator swallow its own failures', () => {
      // A Catch inside the iterator would mark a broken chunk as succeeded and
      // Aggregate would never learn a chunk failed. Isolation belongs on the
      // Map, one level up.
      for (const state of Object.values(iterator.States)) {
        expect(state.Catch).toBeUndefined();
      }
    });

    it('bounds concurrency to match the connection-pool sizing', () => {
      // Each Lambda container holds its own pool. This number times the pool
      // size is the connection count, which is why bootstrap.ts pins max: 1.
      expect(map.MaxConcurrency).toBe(10);
    });
  });

  describe('retry policy', () => {
    it('retries every chunk stage on transient faults', () => {
      for (const state of Object.values(iterator.States)) {
        const errors = state.Retry?.flatMap((r) => r.ErrorEquals) ?? [];
        const retries =
          errors.includes('Lambda.TooManyRequestsException') || errors.includes('States.ALL');

        expect(retries).toBe(true);
      }

      expect(Object.keys(iterator.States)).toHaveLength(CHUNK_STAGES.length);
    });

    it('retries Load on any error, not just Lambda faults', () => {
      // Load's failures are typically a dropped connection or a lock timeout,
      // which are not Lambda service errors and succeed on a second attempt.
      const retry = iterator.States.Load.Retry?.[0];

      expect(retry?.ErrorEquals).toEqual(['States.ALL']);
      expect(retry?.MaxAttempts).toBe(2);
    });

    it('does not retry ValidateFile on content errors', () => {
      // A FileValidationError is the dealer's file being wrong and fails
      // identically every time; retrying wastes a minute and three
      // invocations before reporting the same thing.
      const errors = asl.States.ValidateFile.Retry?.flatMap((r) => r.ErrorEquals) ?? [];

      expect(errors).not.toContain('States.ALL');
      expect(errors).toContain('Lambda.ServiceException');
    });

    it('uses jitter so retries do not synchronise', () => {
      // Ten chunks failing together and retrying in lockstep is a thundering
      // herd against the same database.
      const withJitter = Object.values(iterator.States).filter((s) =>
        s.Retry?.some((r) => r.JitterStrategy === 'FULL'),
      );

      expect(withJitter).toHaveLength(CHUNK_STAGES.length);
    });
  });

  describe('terminal paths', () => {
    it('skips the Map for a header-only file', () => {
      // An empty inventory is not a failure; Aggregate records COMPLETED with
      // zero counts.
      expect(asl.States.HasChunks.Type).toBe('Choice');
      expect(asl.States.HasChunks.Default).toBe('Aggregate');
    });

    it('reaches Aggregate whether chunks succeeded or failed', () => {
      expect(map.Next).toBe('Aggregate');
      expect(map.Catch?.[0].Next).toBe('Aggregate');
    });

    it('marks the job FAILED before failing the execution', () => {
      // Otherwise the execution shows failed in the console while the dealer
      // polls a job stuck at PROCESSING forever.
      expect(asl.States.MarkJobFailed.Next).toBe('JobFailed');
      expect(asl.States.JobFailed.Type).toBe('Fail');
    });

    it('routes every whole-file failure to MarkJobFailed', () => {
      for (const name of ['ValidateFile', 'SplitChunks', 'Aggregate']) {
        expect(asl.States[name].Catch?.[0].Next).toBe('MarkJobFailed');
      }
    });
  });

  describe('payload shape', () => {
    it('unwraps $.Payload so the envelope is not nested', () => {
      // lambda:invoke wraps the result. Without OutputPath the next state
      // reads $.Payload.Payload.key and the chain silently breaks.
      const all = { ...asl.States, ...iterator.States };

      for (const state of Object.values(all)) {
        if (state.Type !== 'Task') continue;
        expect(state.OutputPath).toBe('$.Payload');
      }
    });

    it('feeds the Map from the chunk array', () => {
      expect(map.ItemsPath).toBe('$.chunks');
      expect(map.ResultPath).toBe('$.chunks');
    });
  });
});
