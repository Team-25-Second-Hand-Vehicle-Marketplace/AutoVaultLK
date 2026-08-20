import { IsOptional, IsString, MaxLength, MinLength, IsUUID } from 'class-validator';

/** Body for internal approve/reject calls from admin-service (FR-02.2). */
export class DealerVerificationDto {
  @IsUUID('4', { message: 'adminId must be a valid UUID' })
  adminId!: string;

  /**
   * Rejection reason (FR-09). Ignored on approve. Optional so an approve body
   * and a reason-less reject both validate against this one DTO.
   */
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason?: string;
}
