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

/**
 * Controlled vocabulary for the search parser and ETL normalizer.
 * Owned by marketplace-service. One self-referencing table serves makes,
 * models, and any future dictionary type.
 *
 * This is the backing store for the large, typo-prone vocabularies that a
 * hardcoded array cannot handle — it needs pg_trgm `similarity()`, which
 * requires a real indexed table. Small closed enums (fuel_type,
 * transmission_type, condition, status) stay as hardcoded arrays plus CHECK
 * constraints and never appear here.
 */
@Entity({ schema: 'marketplace', name: 'vehicle_dictionaries' })
export class VehicleDictionary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * A MODEL row points at its MAKE row. NULL for MAKE rows and for any
   * flat dictionary type. Makes a make-scoped model lookup a plain
   * `WHERE parent_id = $1`, which is what the parser's
   * "resolve make first, then constrain model by it" rule needs.
   */
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
