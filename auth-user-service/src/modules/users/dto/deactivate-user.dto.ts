import { IsUUID } from 'class-validator';

/** Body for internal deactivate calls from admin-service (ADR-005). */
export class DeactivateUserDto {
  @IsUUID('4', { message: 'adminId must be a valid UUID' })
  adminId!: string;
}
