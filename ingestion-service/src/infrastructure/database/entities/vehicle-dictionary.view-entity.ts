import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DictionaryType = 'MAKE' | 'MODEL' | 'BODY_TYPE' | 'COLOR';

/**
 * Read-only projection of marketplace.vehicle_dictionaries, owned by
 * marketplace-service. Declared here so the ETL normalizer can resolve
 * make/model against the same vocabulary the search parser uses — the two
 * halves must agree or they drift silently (ingest storing MERCEDES-BENZ
 * while search queries Mercedes returns zero rows, with no error).
 *
 * Never migrated by this service — database/ created the real table.
 *
 * ingestion_service_role holds SELECT only (see database/src/grants.sql).
 * Alias promotion from the ETL pipeline goes through marketplace-service's
 * API, not a direct write — that is what keeps the platform to one
 * cross-schema write exception rather than two.
 *
 * Read pattern: load a snapshot at container init and refresh periodically.
 * Not a per-row query — the ETL design is explicit that groqNormalizeFn
 * matches against an in-memory table snapshot, which is what keeps the
 * MaxConcurrency: 10 connection-pool argument intact.
 */
@Entity({ schema: 'marketplace', name: 'vehicle_dictionaries', synchronize: false })
export class VehicleDictionaryView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ name: 'dictionary_type', type: 'varchar', length: 20 })
  dictionaryType: DictionaryType;

  @Column({ name: 'canonical_value', type: 'varchar', length: 100 })
  canonicalValue: string;

  @Column({ type: 'jsonb' })
  aliases: string[];

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;
}
