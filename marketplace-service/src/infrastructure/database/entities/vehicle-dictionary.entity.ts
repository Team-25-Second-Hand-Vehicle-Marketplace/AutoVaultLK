import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type DictionaryType = 'MAKE' | 'MODEL' | 'BODY_TYPE' | 'COLOR';



@Entity({ schema: 'marketplace', name: 'vehicle_dictionaries' })
export class VehicleDictionary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

 
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => VehicleDictionary, (entry) => entry.children, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'parent_id' })
  parent?: VehicleDictionary | null;

  @OneToMany(() => VehicleDictionary, (entry) => entry.parent)
  children?: VehicleDictionary[];

  @Index()
  @Column({ name: 'dictionary_type', type: 'varchar', length: 20 })
  dictionaryType: DictionaryType;

  @Column({ name: 'canonical_value', type: 'varchar', length: 100 })
  canonicalValue: string;


    // Which vehicle types this entry applies to. MAKE rows span several
  // ('Toyota' -> CAR, VAN, SUV, LORRY); MODEL rows carry exactly one.
  // Empty array means "applies to all types" — used by flat dictionary
  // types (BODY_TYPE, COLOR) that have no type scoping.
  @Column({ name: 'vehicle_types', type: 'text', array: true, default: () => `'{}'` })
  vehicleTypes: string[];

  
  /**
   * Known misspellings and colloquial forms — e.g. ["toyata"] for Toyota,
   * ["benz"] for Mercedes-Benz. Seeded by hand and grown by the
   * alias-promotion loop: corrections logged often enough get promoted here,
   * so the next identical query resolves in the rules path at zero cost.
   */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  aliases: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
