import type { ExtractedFilters } from '../parser/types';

export type SearchRankOptions = {
  queryEmbedding?: number[];
  /** Leftover text ranked with pg_trgm word_similarity (filter + trigram). */
  trigramQuery?: string;
  /**
   * When true, also require search_text to be word-similar to trigramQuery.
   * Only for the "nothing resolved" last-resort path — never to re-match
   * a make/model the parser already extracted.
   */
  trigramWhere?: boolean;
};

/** Looser than parser make/model gating (0.45); pg_trgm's default similarity. */
export const LAST_RESORT_WORD_SIMILARITY = 0.3;

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

/**
 * SAD 3.6.2 / FR-24: vector first; if MiniLM is down, pg_trgm on leftovers
 * (and a gated WHERE only when the parser extracted no filters at all).
 */
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
  if (input.queryEmbedding?.length) {
    return {
      rank: { queryEmbedding: input.queryEmbedding },
      usedSemanticRanking: true,
      usedTrigramFallback: false,
    };
  }

  const leftover = input.semanticText.trim();
  const resolved = hasResolvedFilters(input.filters);

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

/**
 * Last-resort retrieval gate. Mutates `params` in place (callers pass a copy).
 * Ranking-only trigram (filters already resolved) must not call this.
 */
export function appendTrigramWhere(
  where: string,
  params: unknown[],
  rank?: SearchRankOptions,
): string {
  if (!rank?.trigramWhere || !rank.trigramQuery?.trim()) return where;
  params.push(rank.trigramQuery.trim());
  const qIdx = params.length;
  params.push(LAST_RESORT_WORD_SIMILARITY);
  const tIdx = params.length;
  return `${where} AND word_similarity($${qIdx}, COALESCE(v.search_text, '')) >= $${tIdx}`;
}
