import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Make } from './make.entity';

/**
 * Named ModelEntity, not Model — "Model" collides too easily with
 * framework/ORM naming conventions.
 */
@Entity({ schema: 'marketplace', name: 'models' })
@Unique('uq_models_make_name', ['makeId', 'canonicalName'])
export class ModelEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'make_id', type: 'uuid' })
  makeId: string;

  @ManyToOne(() => Make, (make) => make.models, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'make_id' })
  make: Make;

  @Column({ name: 'canonical_name', type: 'varchar', length: 100 })
  canonicalName: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
