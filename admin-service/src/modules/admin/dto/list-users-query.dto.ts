import { IsIn, IsOptional } from 'class-validator';

export class ListUsersQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'VERIFIED', 'REJECTED'])
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
}
