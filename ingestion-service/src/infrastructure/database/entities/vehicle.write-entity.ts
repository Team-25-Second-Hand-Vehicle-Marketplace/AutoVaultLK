import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * loadFn's target entity — the ONE documented cross-schema write in the
 * whole platform (see database/src/grants.sql and
 * Documentation/plan-b-reads-cross-schemas.md §6). ingestion_service_role
 * holds SELECT + INSERT + UPDATE on this table, never DELETE.
 *
 * synchronize: false — this service never migrates marketplace.vehicles;
 * marketplace-service's migrations own the DDL. Kept in sync manually
 * with marketplace-service/src/infrastructure/database/entities/vehicle.entity.ts —
 * see the silent-drift checklist in plan-b-reads-cross-schemas.md §9A,
 * item 4.
 *
 * Named with a `.write-entity.ts` suffix (not `.entity.ts`) to make this
 * table's exceptional status visible at a glance in the file tree.
 */
@Entity({ schema: 'marketplace', name: 'vehicles', synchronize: false })
export class VehicleWriteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dealer_id', type: 'uuid' })
  dealerId: string;

  @Column({ name: 'upload_job_id', type: 'uuid', nullable: true })
  uploadJobId: string | null;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 20 })
  vehicleType: string;

  @Column({ type: 'varchar', length: 100 })
  make: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 20 })
  condition: string;

  @Column({ name: 'manufacture_year', type: 'smallint' })
  manufactureYear: number;

  @Column({ name: 'registration_year', type: 'smallint', nullable: true })
  registrationYear: number | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v === null ? null : parseFloat(v)),
    },
  })
  price: number;

  @Column({ name: 'is_negotiable', type: 'boolean', default: false })
  isNegotiable: boolean;

  @Column({ type: 'integer' })
  mileage: number;

  @Column({ name: 'fuel_type', type: 'varchar', length: 20, nullable: true })
  fuelType: string | null;

  @Column({ name: 'transmission_type', type: 'varchar', length: 20, nullable: true })
  transmissionType: string | null;

  @Column({ name: 'engine_capacity_cc', type: 'integer', nullable: true })
  engineCapacityCc: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  color: string | null;

  @Column({ name: 'owners_count', type: 'smallint', nullable: true })
  ownersCount: number | null;

  @Column({ name: 'location_city', type: 'varchar', length: 100, nullable: true })
  locationCity: string | null;

  @Column({ name: 'location_district', type: 'varchar', length: 100, nullable: true })
  locationDistrict: string | null;

  // Keys the image-branch join. Blank is legitimate (unregistered
  // imports); duplicates among non-null values are rejected pre-fan-out.
  @Column({ name: 'registration_number', type: 'varchar', length: 50, nullable: true })
  registrationNumber: string | null;

  @Column({ name: 'chassis_number', type: 'varchar', length: 100, nullable: true })
  chassisNumber: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'make_raw', type: 'varchar', length: 100, nullable: true })
  makeRaw: string | null;

  @Column({ name: 'model_raw', type: 'varchar', length: 100, nullable: true })
  modelRaw: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING_REVIEW' })
  status: string;

  // Populated by Enrich — body_type, seats and every other type-specific
  // attribute live here, not as columns.
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  specs: Record<string, unknown>;

  @Column({ name: 'search_text', type: 'text', nullable: true })
  searchText: string | null;

  // Written as '[0.1,0.2,...]' by embedFn; pgvector casts it on write.
  @Column({ type: 'text', nullable: true })
  embedding: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
