import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of marketplace.models (Option B reference data).
 * See make.view-entity.ts for the caching discipline this must follow.
 */
@Entity({ schema: 'marketplace', name: 'models', synchronize: false })
export class ModelView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'make_id', type: 'uuid' })
  makeId: string;

  @Column({ name: 'canonical_name', type: 'varchar', length: 100 })
  canonicalName: string;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;
}
