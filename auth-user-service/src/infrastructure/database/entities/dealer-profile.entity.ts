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

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

@Entity({ schema: 'auth', name: 'dealer_profiles' })
export class DealerProfile {
  // user_id is both PK and FK — one profile per user
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, (user) => user.dealerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'company_name', type: 'varchar', length: 255 })
  companyName!: string;

  @Column({ name: 'contact_number', type: 'varchar', length: 50, nullable: true })
  contactNumber!: string | null;

  @Column({ name: 'is_verified', type: 'varchar', length: 20, default: 'PENDING' })
  isVerified!: VerificationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
