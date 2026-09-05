import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PAGE_SIZE, SORT_OPTIONS } from '../constants/vehicle-attributes.constants';
import type { SortOption } from '../constants/vehicle-attributes.constants';

export class NlSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q: string;

  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: SortOption;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  facets?: boolean;
}
