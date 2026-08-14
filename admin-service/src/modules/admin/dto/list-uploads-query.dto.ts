import { IsIn, IsOptional } from 'class-validator';

export class ListUploadsQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL'])
  status?: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';
}
