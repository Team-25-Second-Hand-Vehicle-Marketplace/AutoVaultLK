import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RejectDealerDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason?: string;
}
