import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DealerType = 'individual' | 'business';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/**
 * Read-only projection of auth.dealer_profiles, owned by auth-user-service.
 *
 * Declared here so the Ingest API can gate POST /ingest/upload on "business
 * dealer, verified" (see api-gateway/openapi/public-api.yaml) without a
 * round trip to auth-user-service on every upload.
 *
 * ingestion_service_role holds SELECT only — see database/src/grants.sql,
 * where the identical grant already exists for marketplace_service_role.
 * Verification state is changed by admin-service through auth-user-service's
 * API; this service never writes it.
 *
 * Never migrated by this service. Deliberately narrower than
 * marketplace-service's copy: only the columns the upload gate reads are
 * declared, so an unrelated schema change cannot break ingestion.
 */
@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {
  // user_id is both PK and FK — one profile per user (migration 3000).
  // upload_jobs.dealer_id references auth.users(id), so this joins directly.
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Added by migration 15000 as a Postgres enum, alongside the older
  // is_verified varchar which is retained for backwards compatibility.
  // Read verification_status, not is_verified.
  @Column({ name: 'dealer_type', type: 'enum', enum: ['individual', 'business'] })
  dealerType: DealerType;

  // Indexed by idx_dealer_profiles_verification_status (migration 15000).
  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: ['PENDING', 'VERIFIED', 'REJECTED'],
  })
  verificationStatus: VerificationStatus;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;
}
