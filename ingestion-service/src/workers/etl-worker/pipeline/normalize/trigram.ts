/**
 * Dice coefficient over padded trigram sets — a copy of
 * marketplace-service/src/modules/search/parser/trigram.ts.
 *
 * Kept byte-identical on purpose: ingestion and search must fold a dealer's
 * misspelling to the same canonical make. If the two used different similarity
 * functions, a row could ingest as "Toyota" and fail to match a query the
 * search side resolves to "Toyota" — the same class of silent divergence the
 * normalize-embed parity test guards against.
 *
 * The padding (`  value `) mirrors Postgres pg_trgm's convention, so scores
 * here are comparable to the ones the trigram index produces.
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

/**
 * Folds away the punctuation and spacing dealers vary on, so "Wagon R",
 * "wagon-r" and "wagonr" share one lookup key. Same rule as
 * marketplace-service's `compact()`.
 */
export function compact(value: string): string {
  return value.toLowerCase().replace(/[\s.\-_/]+/g, '');
}
