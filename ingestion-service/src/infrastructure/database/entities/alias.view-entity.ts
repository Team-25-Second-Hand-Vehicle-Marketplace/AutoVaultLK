import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of marketplace.aliases (Option B reference data).
 *
 * ingestion_service_role holds SELECT only — it may NOT write here
 * directly. Alias promotion (logged corrections becoming seeded aliases)
 * goes through marketplace-service's API instead of a direct write; this
 * is what keeps the platform to one cross-schema write exception
 * (vehicles/vehicle_images) rather than two. See
 * plan-b-reads-cross-schemas.md §9.
 */
@Entity({ schema: 'marketplace', name: 'aliases', synchronize: false })
export class AliasView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  alias: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 20 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ type: 'varchar', length: 20 })
  source: string;

  @Column({ name: 'hit_count', type: 'integer' })
  hitCount: number;
}
