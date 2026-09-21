import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 128,
    unique: true,
    nullable: true,
  })
  idempotencyKey: string | null;

  /** Delivery attempts made so far. FR-53: capped at MAX_DELIVERY_ATTEMPTS. */
  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount: number;

  /**
   * When the retry sweep may next claim this row. NULL means it is not waiting
   * on a retry — either it is SENT, or it exhausted its attempts and is FAILED.
   */
  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  /** Why the last attempt failed, kept for diagnosis once a row lands FAILED. */
  @Column({ name: 'last_error', type: 'varchar', length: 500, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
