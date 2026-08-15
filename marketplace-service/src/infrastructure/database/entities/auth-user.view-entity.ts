import { Column, Entity, PrimaryColumn } from 'typeorm';

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

  /**
   * Read by the JWT strategy: a token is refused for a non-ADMIN whose email
   * was never verified, even if the signature is valid.
   */
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;
}
