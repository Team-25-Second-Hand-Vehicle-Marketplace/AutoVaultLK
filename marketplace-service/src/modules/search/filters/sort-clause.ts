import { SortOption } from '../constants/vehicle-attributes.constants';
import { toPgVector } from '../../../shared/normalize-embed';

const SORT_SQL: Record<SortOption, string> = {
  relevance: 'v.created_at DESC',
  price_asc: 'v.price ASC',
  price_desc: 'v.price DESC',
  year_desc: 'COALESCE(v.registration_year, v.manufacture_year) DESC',
  mileage_asc: 'v.mileage ASC',
  newest: 'v.created_at DESC',
};

/**
 * Builds a parameterized ORDER BY. Vector ranking (FR-23) wins over
 * ts_rank when a query embedding is present; both stay off the SQL string
 * as bound parameters.
 */
export function buildOrderBy(
  sort: SortOption | undefined,
  params: unknown[],
  options?: { keyword?: string; queryEmbedding?: number[] },
): string {
  const key = sort ?? 'relevance';
  if (key === 'relevance' && options?.queryEmbedding?.length) {
    params.push(toPgVector(options.queryEmbedding));
    return `v.embedding <=> $${params.length}::vector ASC NULLS LAST, v.created_at DESC`;
  }
  if (key === 'relevance' && options?.keyword?.trim()) {
    params.push(options.keyword.trim());
    return `ts_rank(v.search_vector, plainto_tsquery('english', $${params.length})) DESC, v.created_at DESC`;
  }
  return SORT_SQL[key];
}
