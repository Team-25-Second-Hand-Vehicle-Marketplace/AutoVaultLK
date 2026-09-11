import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { EtlStage } from './etl-stage-log.entity';
import { UploadJob } from './upload-job.entity';

@Entity({ schema: 'ingestion', name: 'rejected_records' })
export class RejectedRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'upload_job_id', type: 'uuid' })
  uploadJobId: string;

  @ManyToOne(() => UploadJob, (job) => job.rejectedRecords, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'upload_job_id' })
  uploadJob: UploadJob;

  /**
   * Which stage rejected the row. Part of the idempotency key: under Step
   * Functions each stage is its own Lambda and ASL retries a failed state, so
   * a stage that rejected rows before failing must be able to replace its own
   * rejections rather than duplicate them (migration 26000).
   */
  @Column({ type: 'varchar', length: 30 })
  stage: EtlStage;

  /** 0 means the whole file was rejected, not a particular row. */
  @Column({ name: 'row_number', type: 'integer' })
  rowNumber: number;

  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, unknown>;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
