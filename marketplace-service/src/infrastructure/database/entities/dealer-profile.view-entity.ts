import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DealerType = 'individual' | 'business';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

@Entity({ schema: 'auth', name: 'dealer_profiles', synchronize: false })
export class DealerProfileView {

  // The table's primary key IS user_id — there is no separate id column.
  // vehicles.dealer_id references auth.users(id), so this joins directly.
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;


  @Column({ name: 'dealer_type', type: 'enum', enum: ['individual', 'business'] })
  dealerType: DealerType;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'contact_number', type: 'varchar', length: 50, nullable: true })
  contactNumber: string | null;

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
