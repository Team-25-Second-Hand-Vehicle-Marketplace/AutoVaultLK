/**
 * Runs tasks with at most `limit` in flight, preserving input order in the
 * results.
 *
 * Hand-rolled rather than a dependency: this is the local stand-in for the Step
 * Functions Map state's MaxConcurrency (SAD §6.6), and it is fifteen lines. A
 * package would be more code to audit than to write, and one fewer thing that
 * has to be true when the orchestrator is replaced by ASL.
 *
 * Rejections are NOT caught here. The orchestrator wraps each chunk in its own
 * error boundary — catching here would rob it of the ability to tell a failed
 * chunk from a successful one, which is exactly what produces PARTIAL.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  task: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];

  const bounded = Math.max(1, Math.min(limit, items.length));
  const results = new Array<TOut>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    // Each worker claims the next index. Reading and incrementing is atomic
    // here only because JavaScript is single-threaded between awaits — the
    // claim must happen before any await, or two workers take the same item.
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: bounded }, () => worker()));

  return results;
}
