import type { ExtractedFilters } from '../parser/types';
import { toPgVector } from '../../../shared/normalize-embed';

export type SearchRankOptions = {
  queryEmbedding?: number[];

  embeddingWhere?: boolean;
  /** Cutoff paired with embeddingWhere — see maxEmbeddingDistanceFor. */
  maxEmbeddingDistance?: number;
  /** Leftover text ranked with pg_trgm word_similarity (filter + trigram). */
  trigramQuery?: string;

  trigramWhere?: boolean;
};

export const LAST_RESORT_WORD_SIMILARITY = 0.3;

export const MAX_EMBEDDING_DISTANCE = 0.7;

/**
 * A one-word query embeds far more noisily than a full sentence — there is
 * simply less context for the model to place it precisely in vector space.
 * Measured directly against this catalog's seed data: the query "sporty"
 * sits at distance 0.811 from a listing whose own description says "Sporty
 * hatch, responsive steering" (the actually-relevant result), while
 * "family friendly vehicle" sits at 0.595 from an UNRELATED listing. A
 * single fixed cutoff cannot fit both — 0.7 is right for multi-word queries
 * (tight enough to keep "family friendly" from returning motorbikes, per
 * the existing test) but wrongly excludes the best possible match for a
 * bare single word.
 *
 * This scales the cutoff by how many meaningful words made it into
 * semanticText: fewer words (less context, noisier embedding) get more
 * distance tolerance. 3+ words keeps today's behavior unchanged.
 */
export function maxEmbeddingDistanceFor(semanticText: string): number {
  const wordCount = semanticText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= 1) return 0.85;
  if (wordCount === 2) return 0.78;
  return MAX_EMBEDDING_DISTANCE;
}

export function hasResolvedFilters(filters: ExtractedFilters): boolean {
  return Boolean(
    filters.vehicleType?.length ||
      filters.make?.length ||
      filters.model?.length ||
      filters.condition?.length ||
      filters.fuelType?.length ||
      filters.transmissionType?.length ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      filters.minYear !== undefined ||
      filters.maxYear !== undefined ||
      filters.minMileage !== undefined ||
      filters.maxMileage !== undefined ||
      filters.specs?.length,
  );
}

export function chooseSearchRank(input: {
  filters: ExtractedFilters;
  semanticText: string;
  rawQuery: string;
  queryEmbedding: number[] | null;
}): {
  rank?: SearchRankOptions;
  usedSemanticRanking: boolean;
  usedTrigramFallback: boolean;
} {
  const resolved = hasResolvedFilters(input.filters);

  if (input.queryEmbedding?.length) {
    return {
      rank: {
        queryEmbedding: input.queryEmbedding,
        embeddingWhere: !resolved,
        maxEmbeddingDistance: maxEmbeddingDistanceFor(input.semanticText),
      },
      usedSemanticRanking: true,
      usedTrigramFallback: false,
    };
  }

  const leftover = input.semanticText.trim();

  if (leftover && resolved) {
    return {
      rank: { trigramQuery: leftover },
      usedSemanticRanking: false,
      usedTrigramFallback: true,
    };
  }

  const raw = input.rawQuery.trim();
  if (!resolved && raw) {
    return {
      rank: { trigramQuery: leftover || raw, trigramWhere: true },
      usedSemanticRanking: false,
      usedTrigramFallback: true,
    };
  }

  return { usedSemanticRanking: false, usedTrigramFallback: false };
}

export function appendTrigramWhere(
  where: string,
  params: unknown[],
  rank?: SearchRankOptions,
): string {
  let gated = where;

  if (rank?.embeddingWhere && rank.queryEmbedding?.length) {
    params.push(toPgVector(rank.queryEmbedding));
    const eIdx = params.length;
    params.push(rank.maxEmbeddingDistance ?? MAX_EMBEDDING_DISTANCE);
    const dIdx = params.length;
    gated = `${gated} AND v.embedding IS NOT NULL AND v.embedding <=> $${eIdx}::vector <= $${dIdx}`;
  }

  if (rank?.trigramWhere && rank.trigramQuery?.trim()) {
    params.push(rank.trigramQuery.trim());
    const qIdx = params.length;
    params.push(LAST_RESORT_WORD_SIMILARITY);
    const tIdx = params.length;
    gated = `${gated} AND word_similarity($${qIdx}, COALESCE(v.search_text, '')) >= $${tIdx}`;
  }

  return gated;
}
