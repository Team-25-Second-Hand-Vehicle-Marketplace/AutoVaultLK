import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UploadJob } from './upload-job.entity';

export type EtlStage =
  | 'VALIDATE_FILE'
  | 'SPLIT_CHUNKS'
  | 'PARSE_NORMALIZE'
  | 'GROQ_NORMALIZE'
  | 'VALIDATE_ROWS'
  | 'ENRICH'
  | 'EMBED'
  | 'LOAD'
  | 'PROCESS_IMAGES'
  | 'AGGREGATE'
  | 'NOTIFY';

export type EtlStageStatus = 'STARTED' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'DEGRADED';

@Entity({ schema: 'ingestion', name: 'etl_stage_logs' })
export class EtlStageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'upload_job_id', type: 'uuid' })
  uploadJobId: string;

  @ManyToOne(() => UploadJob, (job) => job.stageLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'upload_job_id' })
  uploadJob: UploadJob;

  @Column({ type: 'varchar', length: 40 })
  stage: EtlStage;

  @Column({ type: 'varchar', length: 20 })
  status: EtlStageStatus;

  @Column({ name: 'chunk_id', type: 'integer', nullable: true })
  chunkId: number | null;

  @Column({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  // Confidence scores land here for threshold tuning
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  metrics: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
