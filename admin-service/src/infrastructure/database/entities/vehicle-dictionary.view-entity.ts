import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of marketplace.vehicle_dictionaries.
 * admin_service_role holds SELECT only on the marketplace schema —
 * marketplace-service owns all writes, reached here through its
 * internal/dictionary API (MarketplaceInternalClient), not this connection.
 */
@Entity({
  schema: 'marketplace',
  name: 'vehicle_dictionaries',
  synchronize: false,
})
export class VehicleDictionaryView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ name: 'dictionary_type', type: 'varchar', length: 20 })
  dictionaryType: string;

  @Column({ name: 'canonical_value', type: 'varchar', length: 100 })
  canonicalValue: string;

  @Column({ type: 'jsonb' })
  aliases: string[];

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;
}
