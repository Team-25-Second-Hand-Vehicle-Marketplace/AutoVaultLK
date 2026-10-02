import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class PresignUploadDto {
  @IsString()
  @MinLength(1)
  csvFileName: string;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  csvFileSize: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  zipFileName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  zipFileSize?: number;
}
