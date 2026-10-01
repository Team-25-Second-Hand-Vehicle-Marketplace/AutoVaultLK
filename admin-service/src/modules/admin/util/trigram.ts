/**
 * Dice coefficient over padded trigram sets - a copy of
 * ingestion-service/src/workers/etl-worker/pipeline/normalize/trigram.ts,
 * itself a copy of marketplace-service's parser/trigram.ts.
 *
 * Kept byte-identical on purpose: this scores a rejected make's raw text
 * against the dictionary using the same function ingestion itself uses to
 * decide whether the two match, so the "closest match" shown to an admin
 * here is the same judgement ingestion already made when it left that row
 * unresolved, not a second opinion.
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
