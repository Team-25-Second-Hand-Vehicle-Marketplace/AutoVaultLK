import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DictionaryType = 'MAKE' | 'MODEL' | 'BODY_TYPE' | 'COLOR';

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
  dictionaryType: DictionaryType;

  @Column({ name: 'canonical_value', type: 'varchar', length: 100 })
  canonicalValue: string;

  @Column({ type: 'jsonb' })
  aliases: string[];

  @Column({ name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @Column({ name: 'vehicle_types', type: 'text', array: true })
  vehicleTypes: string[];
}
