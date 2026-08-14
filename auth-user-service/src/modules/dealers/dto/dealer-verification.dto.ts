import { IsUUID } from 'class-validator';

/** Body for internal approve/reject calls from admin-service (FR-02.2). */
export class DealerVerificationDto {
  @IsUUID('4', { message: 'adminId must be a valid UUID' })
  adminId!: string;
}
