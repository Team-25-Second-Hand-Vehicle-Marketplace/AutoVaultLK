import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationType =
  | 'UPLOAD_COMPLETED'
  | 'UPLOAD_FAILED'
  | 'LISTING_APPROVED'
  | 'LISTING_REJECTED'
  | 'DEALER_VERIFIED'
  | 'DEALER_REJECTED'
  | 'WELCOME'
  | 'PASSWORD_RESET';

export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'BOUNCED';

@Entity({ schema: 'notification', name: 'notifications' })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: NotificationStatus;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true, nullable: true })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
