import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.dealer_profiles. See auth-user.view-entity.ts
 * for the read-only discipline this follows.
 */
@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'is_verified', type: 'varchar', length: 20 })
  isVerified: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
