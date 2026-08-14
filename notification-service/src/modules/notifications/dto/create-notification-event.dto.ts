import { Transform } from 'class-transformer';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export const INTAKE_NOTIFICATION_TYPES = [
  'UPLOAD_COMPLETED',
  'UPLOAD_FAILED',
  'DEALER_VERIFIED',
  'DEALER_REJECTED',
] as const;

export type IntakeNotificationType = (typeof INTAKE_NOTIFICATION_TYPES)[number];

export class CreateNotificationEventDto {
  @IsIn(INTAKE_NOTIFICATION_TYPES)
  type: IntakeNotificationType;

  @IsUUID('4')
  userId: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  idempotencyKey: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
