import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.users, owned by auth-user-service.
 * Declared here so ingestion can validate dealer_id on upload_jobs and
 * resolve dealer capabilities (bulk-upload permission, listing cap).
 * Never migrated by this service.
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
}
