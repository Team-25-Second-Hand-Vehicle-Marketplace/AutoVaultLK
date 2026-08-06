import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VehicleImage } from './vehicle-image.entity';

export type VehicleType = 'CAR' | 'BIKE' | 'VAN' | 'TRUCK' | 'SUV' | 'BUS';
export type Condition = 'NEW' | 'USED' | 'RECONDITIONED';
export type FuelType = 'PETROL' | 'DIESEL' | 'HYBRID' | 'ELECTRIC' | 'CNG';
export type TransmissionType = 'MANUAL' | 'AUTOMATIC' | 'CVT' | 'SEMI_AUTOMATIC';
export type VehicleStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'LIVE'
  | 'SOLD'
  | 'ARCHIVED'
  | 'REJECTED';

@Entity({ schema: 'marketplace', name: 'vehicles' })
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dealer_id', type: 'uuid' })
  dealerId: string;

  @Column({ name: 'upload_job_id', type: 'uuid', nullable: true })
  uploadJobId: string | null;

  @Column({ name: 'vehicle_type', type: 'varchar', length: 20, default: 'CAR' })
  vehicleType: VehicleType;

  @Column({ type: 'varchar', length: 100 })
  make: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 20, default: 'USED' })
  condition: Condition;

  @Column({ name: 'manufacture_year', type: 'smallint' })
  manufactureYear: number;

  @Column({ name: 'registration_year', type: 'smallint', nullable: true })
  registrationYear: number | null;

  // numeric(14,2) comes back from pg as a string by default; this
  // transformer keeps it a number in application code.
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
  fuelType: FuelType | null;

  @Column({ name: 'transmission_type', type: 'varchar', length: 20, nullable: true })
  transmissionType: TransmissionType | null;

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

  @Column({ name: 'registration_number', type: 'varchar', length: 50, nullable: true })
  registrationNumber: string | null;

  @Column({ name: 'chassis_number', type: 'varchar', length: 100, nullable: true })
  chassisNumber: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING_REVIEW' })
  status: VehicleStatus;

  // Type-specific attributes (body_type, seats, doors, sunroof, airbags,
  // drive_type, etc.) live here, not as columns — a bike has no body_type,
  // a truck has no seats. Backing dictionary is KNOWN_SPEC_KEYS.
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  specs: Record<string, unknown>;

  // Built by Enrich from the columns above + description. No enrichment
  // band words — those derivations were deliberately removed.
  @Column({ name: 'search_text', type: 'text', nullable: true })
  searchText: string | null;

  // pgvector column. TypeORM has no native vector type — 'text' is the
  // transport, and pgvector casts it. Write as '[0.1,0.2,...]'.
  // Similarity search must use a raw query (embedding <=> $1::vector),
  // never the query builder. select: false keeps 384 floats out of every
  // ordinary SELECT.
  @Column({ type: 'text', nullable: true, select: false })
  embedding: string | null;

  // Maintained by a database trigger — never written from application code.
  @Column({
    name: 'search_vector',
    type: 'tsvector',
    nullable: true,
    select: false,
    update: false,
    insert: false,
  })
  searchVector: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => VehicleImage, (image) => image.vehicle)
  images?: VehicleImage[];
}
