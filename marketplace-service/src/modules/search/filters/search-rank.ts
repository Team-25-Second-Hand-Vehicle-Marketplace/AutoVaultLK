import type { ExtractedFilters } from '../parser/types';
import { toPgVector } from '../../../shared/normalize-embed';

export type SearchRankOptions = {
  queryEmbedding?: number[];

  embeddingWhere?: boolean;
  /** Leftover text ranked with pg_trgm word_similarity (filter + trigram). */
  trigramQuery?: string;

  trigramWhere?: boolean;
};

export const LAST_RESORT_WORD_SIMILARITY = 0.3;

export const MAX_EMBEDDING_DISTANCE = 0.7;

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
      rank: { queryEmbedding: input.queryEmbedding, embeddingWhere: !resolved },
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
    params.push(MAX_EMBEDDING_DISTANCE);
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
