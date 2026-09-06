import { mapWithConcurrency } from '../../../src/workers/etl-worker/pipeline/concurrency';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('mapWithConcurrency', () => {
  it('preserves input order regardless of completion order', async () => {
    // Chunk results are tallied positionally; out-of-order results would
    // attribute one chunk's counts to another.
    const result = await mapWithConcurrency([30, 10, 20], 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });

    expect(result).toEqual([30, 10, 20]);
  });

  it('never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });

    expect(peak).toBe(3);
  });

  it('starts a waiting item as soon as a slot frees', async () => {
    // A worker-pool, not batches: with batching, three slow items would block
    // the fourth until all three finished.
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const started: number[] = [];

    const all = mapWithConcurrency([0, 1, 2], 2, async (i) => {
      started.push(i);
      return gates[i].promise;
    });

    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    gates[0].resolve(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve(1);
    gates[2].resolve(2);
    await all;
  });

  it('handles an empty input', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });

  it('clamps a limit below 1', async () => {
    // A limit of 0 would spawn no workers and hang forever.
    expect(await mapWithConcurrency([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    // The orchestrator wraps each chunk in its own boundary; catching here
    // would rob it of the ability to tell a failed chunk from a good one.
    await expect(
      mapWithConcurrency([1], 1, async () => {
        throw new Error('chunk exploded');
      }),
    ).rejects.toThrow('chunk exploded');
  });

  it('passes the index to the task', async () => {
    const result = await mapWithConcurrency(['a', 'b'], 2, async (item, index) => `${index}${item}`);

    expect(result).toEqual(['0a', '1b']);
  });
});
