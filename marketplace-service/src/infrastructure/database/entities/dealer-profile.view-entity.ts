import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.dealer_profiles for listing enrichment
 * (FR-18.1). Mutations go through auth-user-service; marketplace holds
 * SELECT only (see database/src/grants.sql).
 */
@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'contact_number', type: 'varchar', length: 50, nullable: true })
  contactNumber: string | null;

  @Column({ name: 'dealer_type', type: 'varchar' })
  dealerType: string;

  @Column({
    name: 'business_registration_number',
    type: 'varchar',
    length: 500,
  })
  businessRegistrationNumber: string;

  @Column({ name: 'business_address', type: 'varchar', length: 500 })
  businessAddress: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ name: 'verification_documents', type: 'jsonb' })
  verificationDocuments: Record<string, unknown>;

  @Column({ name: 'verification_status', type: 'varchar' })
  verificationStatus: string;

  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  verifiedBy: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
