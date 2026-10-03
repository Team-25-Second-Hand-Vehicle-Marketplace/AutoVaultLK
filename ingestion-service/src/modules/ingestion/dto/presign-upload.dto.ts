import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

export class PresignUploadDto {
  /**
   * The declared format of the inventory file. Mandatory and never guessed
   * from the extension: see IngestionUploadService.parseFormat.
   */
  @IsIn(['csv', 'json'], { message: 'format is required: "csv" or "json"' })
  format: string;

  /**
   * The inventory file - a CSV or a JSON file according to `format`. The
   * `csv` prefix is kept so existing clients of this endpoint keep working.
   */
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
