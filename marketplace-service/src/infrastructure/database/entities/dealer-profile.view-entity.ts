import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DealerType = 'individual' | 'business';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/**
 * Read-only projection of auth.dealer_profiles, owned by auth-user-service.
 * Declared here only so marketplace can join on vehicles.dealer_id — this is
 * what backs the `verifiedDealersOnly` search filter (plan-b §8: Plan B
 * uniquely allows search to filter on dealer verification status).
 * Never migrated by this service — database/ created the real table.
 *
 * marketplace_service_role holds only SELECT here (database/src/grants.sql).
 *
 * ⚠️ CROSS-SERVICE COUPLING (plan-b §risk-1): marketplace search reads
 * `verification_status`. Renaming that column or altering its enum in
 * auth-user-service breaks the verified-dealer filter silently — grep is the
 * enforcement mechanism here, not the compiler. Verification-document columns
 * are deliberately omitted: search never needs them.
 */
@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {

  // The table's primary key IS user_id — there is no separate id column.
  // vehicles.dealer_id references auth.users(id), so this joins directly.
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;


  @Column({ name: 'dealer_type', type: 'enum', enum: ['individual', 'business'] })
  dealerType: DealerType;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  // Indexed by idx_dealer_profiles_verification_status (migration 15000).
  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: ['PENDING', 'VERIFIED', 'REJECTED'],
  })
  verificationStatus: VerificationStatus;
}
