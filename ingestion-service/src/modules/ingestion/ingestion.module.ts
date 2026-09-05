import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfileView } from '../../infrastructure/database/entities/dealer-profile.view-entity';
import { EtlStageLog } from '../../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../infrastructure/database/entities/upload-job.entity';
import { QueueBootstrapService } from './queue-bootstrap.service';
import { DealerProfileRepository } from './repositories/dealer-profile.repository';
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
  imports: [TypeOrmModule.forFeature([UploadJob, RejectedRecord, EtlStageLog, DealerProfileView])],
  providers: [
    UploadJobRepository,
    RejectedRecordRepository,
    EtlStageLogRepository,
    DealerProfileRepository,
    // Placeholder ETL trigger; replaced by LocalOrchestrator in Phase A.
    QueueBootstrapService,
  ],
  exports: [
    UploadJobRepository,
    RejectedRecordRepository,
    EtlStageLogRepository,
    DealerProfileRepository,
  ],
})
export class IngestionModule {}
