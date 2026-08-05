import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.users. admin_service_role holds SELECT
 * across every schema for dashboards and reports — STRICTLY read-only;
 * every mutation (deactivating a user, verifying a dealer) goes through
 * auth-user-service's API. Never migrated by this service.
 */
@Entity({ schema: 'auth', name: 'users', synchronize: false })
export class AuthUserView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  role: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
