import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.users, owned by auth-user-service.
 * Declared here so notification-service can resolve a recipient's email
 * address before sending. Never migrated by this service.
 */
@Entity({ schema: 'auth', name: 'users', synchronize: false })
export class AuthUserView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;
}
