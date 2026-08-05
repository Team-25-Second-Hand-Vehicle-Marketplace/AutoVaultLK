import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of marketplace.makes (Option B reference data).
 * ingestion_service_role holds SELECT only — see database/src/grants.sql.
 *
 * groqNormalizeFn and parseNormalizeFn load a snapshot of this table into
 * memory at container init and refresh periodically; this entity is not
 * meant to be queried per row during the hot ETL path.
 */
@Entity({ schema: 'marketplace', name: 'makes', synchronize: false })
export class MakeView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'canonical_name', type: 'varchar', length: 100 })
  canonicalName: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;
}
