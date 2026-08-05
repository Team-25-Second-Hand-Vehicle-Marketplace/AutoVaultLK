import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
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

  @Column({ name: 'row_number', type: 'integer' })
  rowNumber: number;

  @Column({ name: 'raw_data', type: 'jsonb' })
  rawData: Record<string, unknown>;

  @Column({ type: 'varchar', length: 500 })
  reason: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
