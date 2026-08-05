import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RejectedRecord } from './rejected-record.entity';
import { EtlStageLog } from './etl-stage-log.entity';

export type UploadJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

@Entity({ schema: 'ingestion', name: 'upload_jobs' })
export class UploadJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dealer_id', type: 'uuid' })
  dealerId: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'csv_s3_path', type: 'varchar', length: 500 })
  csvS3Path: string;

  @Column({ name: 'zip_s3_path', type: 'varchar', length: 500, nullable: true })
  zipS3Path: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: UploadJobStatus;

  @Column({ name: 'total_records', type: 'integer', default: 0 })
  totalRecords: number;

  @Column({ name: 'valid_records', type: 'integer', default: 0 })
  validRecords: number;

  @Column({ name: 'invalid_records', type: 'integer', default: 0 })
  invalidRecords: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => RejectedRecord, (record) => record.uploadJob)
  rejectedRecords?: RejectedRecord[];

  @OneToMany(() => EtlStageLog, (log) => log.uploadJob)
  stageLogs?: EtlStageLog[];
}
