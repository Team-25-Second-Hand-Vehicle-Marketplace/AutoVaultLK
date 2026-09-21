import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_REJECTIONS_PAGE_SIZE = 50;

/**
 * A pathological file can reject every row, so the page size is capped rather
 * than left to the caller. 200 rows of raw_data is already a large response —
 * see the truncation note on RejectedRecordDto.
 */
export const MAX_REJECTIONS_PAGE_SIZE = 200;

export class RejectionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_REJECTIONS_PAGE_SIZE)
  limit?: number;
}
