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



  @Column({ name: 'vehicle_types', type: 'text', array: true, default: () => `'{}'` })
  vehicleTypes: string[];


  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  aliases: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
