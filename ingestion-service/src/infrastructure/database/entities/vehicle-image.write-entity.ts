import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * imagesFn's target entity — part of the same documented cross-schema
 * write exception as VehicleWriteEntity. See that file's header comment.
 */
@Entity({ schema: 'marketplace', name: 'vehicle_images', synchronize: false })
export class VehicleImageWriteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vehicle_id', type: 'uuid' })
  vehicleId: string;

  @Column({ name: 's3_path', type: 'varchar', length: 500 })
  s3Path: string;

  @Column({ name: 'processed_path', type: 'varchar', length: 500, nullable: true })
  processedPath: string | null;

  @Column({ name: 'thumbnail_path', type: 'varchar', length: 500, nullable: true })
  thumbnailPath: string | null;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @Column({ name: 'display_order', type: 'integer', default: 0 })
  displayOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
