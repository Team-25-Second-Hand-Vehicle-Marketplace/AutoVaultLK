import { IsUUID } from 'class-validator';

/** Body for internal approve/reject calls from admin-service (FR-02.2). */
export class DealerVerificationDto {
  @IsUUID()
  adminId: string;
}
