import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ModelEntity } from './model.entity';

/**
 * Reference data (Option B) — owned solely by marketplace-service.
 * ingestion-service holds read-only SELECT and caches a snapshot in
 * memory rather than querying per row. See database/src/grants.sql.
 */
@Entity({ schema: 'marketplace', name: 'makes' })
export class Make {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'canonical_name', type: 'varchar', length: 100, unique: true })
  canonicalName: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => ModelEntity, (model) => model.make)
  models?: ModelEntity[];
}
