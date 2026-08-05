import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DealerProfile } from './dealer-profile.entity';
import { RefreshToken } from './refresh-token.entity';

export type UserRole = 'BUYER' | 'DEALER' | 'ADMIN';

@Entity({ schema: 'auth', name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'BUYER' })
  role: UserRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToOne(() => DealerProfile, (profile) => profile.user)
  dealerProfile?: DealerProfile;

  @OneToMany(() => RefreshToken, (token) => token.user)
  refreshTokens?: RefreshToken[];
}
