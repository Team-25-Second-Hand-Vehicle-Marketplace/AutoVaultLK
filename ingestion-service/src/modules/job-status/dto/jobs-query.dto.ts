import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_JOBS_PAGE_SIZE = 20;

/** A prolific dealer's history is still bounded to a sane page size per request. */
export const MAX_JOBS_PAGE_SIZE = 100;

export class JobsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_JOBS_PAGE_SIZE)
  limit?: number;
}
