import { IsIn, IsOptional } from 'class-validator';

export const LISTING_SORT_OPTIONS = ['createdAt', 'confidence_asc'] as const;
export type ListingSortOption = (typeof LISTING_SORT_OPTIONS)[number];

export class MyListingsQueryDto {
  @IsOptional()
  @IsIn(LISTING_SORT_OPTIONS)
  sort?: ListingSortOption;
}
