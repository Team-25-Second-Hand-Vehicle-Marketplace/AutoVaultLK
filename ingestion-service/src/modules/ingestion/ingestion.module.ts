import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EtlStageLog } from '../../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../infrastructure/database/entities/upload-job.entity';
import { EtlStageLogRepository } from './repositories/etl-stage-log.repository';
import { RejectedRecordRepository } from './repositories/rejected-record.repository';
import { UploadJobRepository } from './repositories/upload-job.repository';

/**
 * Owns the write side of the `ingestion` schema.
 *
 * The controllers for POST /ingest/upload land here in a later phase; the
 * repositories are exported now so the ETL worker and the upload API can both
 * be built against a stable surface (the 0.3/0.4 handoff point).
 */
@Module({
  imports: [TypeOrmModule.forFeature([UploadJob, RejectedRecord, EtlStageLog])],
  providers: [UploadJobRepository, RejectedRecordRepository, EtlStageLogRepository],
  exports: [UploadJobRepository, RejectedRecordRepository, EtlStageLogRepository],
})
export class IngestionModule {}
