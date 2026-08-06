import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.dealer_profiles. See auth-user.view-entity.ts
 * for the read-only discipline this follows.
 *
 * Includes the verification columns because approving and rejecting dealer
 * registrations is an administrator action — the dashboard needs to see the
 * dealer type, the uploaded documents, and who decided. The *mutation*
 * still goes through auth-user-service's API; admin_service_role holds
 * SELECT only here.
 */
@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'contact_number', type: 'varchar', length: 50, nullable: true })
  contactNumber: string | null;

  @Column({ name: 'dealer_type', type: 'varchar', length: 20, nullable: true })
  dealerType: string | null;

  @Column({
    name: 'business_registration_number',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  businessRegistrationNumber: string | null;

  @Column({ name: 'business_address', type: 'varchar', length: 500, nullable: true })
  businessAddress: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  /** S3 references to uploaded NIC / business-registration documents. */
  @Column({ name: 'verification_documents', type: 'jsonb' })
  verificationDocuments: unknown[];

  @Column({ name: 'is_verified', type: 'varchar', length: 20 })
  isVerified: string;

  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  verifiedBy: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
