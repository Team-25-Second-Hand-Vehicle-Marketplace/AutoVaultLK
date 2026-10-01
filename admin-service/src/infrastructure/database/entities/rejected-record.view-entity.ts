import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Read-only projection of ingestion.rejected_records - the row-level detail
 * behind an upload job's invalid_records count. admin_service_role holds
 * SELECT only on the ingestion schema; ingestion-service owns all writes.
 */
@Entity({ schema: 'ingestion', name: 'rejected_records', synchronize: false })
export class RejectedRecordView {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'upload_job_id', type: 'uuid' })
  uploadJobId: string;

  @Column({ type: 'varchar', length: 30 })
  stage: string;

  /** 0 means the whole file was rejected, not a particular row. */
  @Column({ name: 'row_number', type: 'integer' })
  rowNumber: number;

  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, unknown>;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
