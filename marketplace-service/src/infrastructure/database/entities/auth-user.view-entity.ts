import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Read-only projection of auth.users, owned by auth-user-service.
 * Declared here only so marketplace can join on vehicles.dealer_id.
 * Never migrated by this service — database/ created the real table.
 *
 * password_hash is deliberately absent. marketplace_service_role holds
 * only SELECT on this table (see database/src/grants.sql), so it could be
 * read but never written — narrow the grant to specific columns if that
 * is not tight enough.
 */
@Entity({ schema: 'auth', name: 'users', synchronize: false })
export class AuthUserView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 20 })
  role: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
