/**
 * In-memory stand-in for pg_trgm `similarity()` so the parser stays a pure
 * function (unit tests, no Postgres). Production Stage 4 will keep this for
 * the cached dictionary snapshot SAD already requires at container start.
 */
export function trigramSimilarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  for (const gram of left) {
    if (right.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (left.size + right.size);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value.toLowerCase()} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}
