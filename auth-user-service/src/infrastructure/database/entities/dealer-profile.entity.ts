import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

// enum for verification status and dealertype
export enum VerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum DealerType {
  INDIVIDUAL = 'individual',
  BUSINESS = 'business',
}

// entity for dealer profile
@Entity({ schema: 'auth', name: 'dealer_profiles' })
export class DealerProfile {

  @PrimaryColumn({
    name: 'user_id',
    type: 'uuid'
  })
  userId!: string;
//user id
  @OneToOne(() => User, user => user.dealerProfile, {
    onDelete: 'CASCADE'
  })
  @JoinColumn({name:'user_id'})
  user!: User;

// dealer type
  @Column({
    name:'dealer_type',
    type:'enum',
    enum: DealerType
  })
  dealerType!: DealerType;


  @Column({
    name:'business_registration_number',
    type:'varchar',
    length:500
  })
  businessRegistrationNumber!: string;


  @Column({
    name:'business_address',
    type:'varchar',
    length:500
  })
  businessAddress!: string;


  @Column({
    name:'city',
    type:'varchar',
    length:100
  })
  city!: string;


  @Column({
    name:'verification_documents',
    type:'jsonb'
  })
  verificationDocuments!: Record<string, unknown>;


  @Column({
    name:'company_name',
    type:'varchar',
    nullable:false
  })
  companyName!: string ;


  @Column({
    name:'contact_number',
    type:'varchar',
    nullable:false
  })
  contactNumber!: string ;


  @Column({
    name:'verification_status',
    type:'enum',
    enum: VerificationStatus,
    default: VerificationStatus.PENDING
  })
  verificationStatus!: VerificationStatus;


  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;


  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
