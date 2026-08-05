import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of notification.notifications, for the admin
 * dashboard (delivery rates).
 */
@Entity({ schema: 'notification', name: 'notifications', synchronize: false })
export class NotificationView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  type: string;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
