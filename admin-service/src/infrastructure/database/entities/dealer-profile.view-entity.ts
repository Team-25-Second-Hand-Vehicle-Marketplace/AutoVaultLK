import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of auth.dealer_profiles. See auth-user.view-entity.ts
 * for the read-only discipline this follows.
 *
 * Includes the verification columns because approving and rejecting dealer
 * registrations is an administrator action — the dashboard needs to see the
 * dealer type, the uploaded documents, and the current verification state.
 * The *mutation* still goes through auth-user-service's API;
 * admin_service_role holds SELECT only here.
 *
 * Column shapes mirror migration 1735000015000-AuthDealerProfileDetails,
 * owned by auth-user-service. `dealer_type` and `verification_status` are
 * native Postgres enums there; they are read as strings here, since this
 * view never writes them.
 */
@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'contact_number', type: 'varchar', length: 50, nullable: true })
  contactNumber: string | null;

  /** Native enum in the source table: 'individual' | 'business'. */
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

  /** S3 references to uploaded NIC / business-registration documents. */
  @Column({ name: 'verification_documents', type: 'jsonb' })
  verificationDocuments: Record<string, unknown>;

  /** Native enum in the source table: 'PENDING' | 'VERIFIED' | 'REJECTED'. */
  @Column({ name: 'verification_status', type: 'varchar' })
  verificationStatus: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
