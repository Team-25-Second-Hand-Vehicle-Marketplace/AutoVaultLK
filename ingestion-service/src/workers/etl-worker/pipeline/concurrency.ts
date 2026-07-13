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
    // here only because JavaScript is single-threaded between awaits - the
    // claim must happen before any await, or two workers take the same item.
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: bounded }, () => worker()));

  return results;
}
