import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of ingestion.upload_jobs, for the admin dashboard.
 */
@Entity({ schema: 'ingestion', name: 'upload_jobs', synchronize: false })
export class UploadJobView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'dealer_id', type: 'uuid' })
  dealerId: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ name: 'total_records', type: 'integer' })
  totalRecords: number;

  @Column({ name: 'valid_records', type: 'integer' })
  validRecords: number;

  @Column({ name: 'invalid_records', type: 'integer' })
  invalidRecords: number;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
