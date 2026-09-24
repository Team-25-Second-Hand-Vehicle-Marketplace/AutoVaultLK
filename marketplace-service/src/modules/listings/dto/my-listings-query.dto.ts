import { IsIn, IsOptional } from 'class-validator';

/**
 * FR-42.1: the dealer's review interface must present PENDING_REVIEW rows in
 * ascending order of normalization confidence — the rows most likely to need
 * a correction are the ones a dealer should see first, not buried under
 * ninety confidently-resolved ones.
 *
 * `createdAt` (the existing, implicit default) stays available rather than
 * being replaced, because it is what every other status the dealer might be
 * looking at — LIVE, SOLD, ARCHIVED — actually wants; only PENDING_REVIEW has
 * a confidence worth sorting by.
 */
export const LISTING_SORT_OPTIONS = ['createdAt', 'confidence_asc'] as const;
export type ListingSortOption = (typeof LISTING_SORT_OPTIONS)[number];

export class MyListingsQueryDto {
  @IsOptional()
  @IsIn(LISTING_SORT_OPTIONS)
  sort?: ListingSortOption;
}
