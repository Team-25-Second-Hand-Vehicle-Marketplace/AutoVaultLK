import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type AliasEntityType = 'MAKE' | 'MODEL';
export type AliasSource = 'SEED' | 'GROQ_PROMOTED' | 'MANUAL';

/**
 * Polymorphic: entityId points at makes.id or models.id depending on
 * entityType. No FK — Postgres can't express a conditional reference
 * across two tables. Integrity here is an application-level concern.
 *
 * Fed by both seed data and the alias-promotion loop: corrections logged
 * frequently enough by search or ingestion get promoted here, so they
 * resolve for free next time instead of reaching Groq/pg_trgm again.
 */
@Entity({ schema: 'marketplace', name: 'aliases' })
@Unique('uq_aliases_alias_type', ['alias', 'entityType'])
export class Alias {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  alias: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 20 })
  entityType: AliasEntityType;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar', length: 20, default: 'SEED' })
  source: AliasSource;

  @Column({ name: 'hit_count', type: 'integer', default: 0 })
  hitCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
