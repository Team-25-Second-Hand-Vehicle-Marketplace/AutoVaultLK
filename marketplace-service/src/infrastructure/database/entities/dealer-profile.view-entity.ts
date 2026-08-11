import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AuthUserView } from './auth-user.view-entity';

export enum DealerType {
  INDIVIDUAL = 'individual',
  BUSINESS = 'business',
}

export enum DealerVerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

@Entity({
  schema: 'auth',
  name: 'dealer_profiles',
  synchronize: false,
})
export class DealerProfileView {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => AuthUserView, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user?: AuthUserView;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName: string;

  @Column({ name: 'contact_number', type: 'varchar', length: 50, nullable: true })
  contactNumber: string | null;

  @Column({ name: 'dealer_type', type: 'enum', enum: DealerType })
  dealerType: DealerType;

  @Column({ name: 'business_registration_number', type: 'varchar', length: 500 })
  businessRegistrationNumber: string;

  @Column({ name: 'business_address', type: 'varchar', length: 500 })
  businessAddress: string;

  @Column({ type: 'varchar', length: 100 })
  city: string;

  @Column({ name: 'verification_documents', type: 'jsonb' })
  verificationDocuments: Record<string, unknown>;

  @Column({
    name: 'verification_status',
    type: 'enum',
    enum: DealerVerificationStatus,
  })
  verificationStatus: DealerVerificationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
