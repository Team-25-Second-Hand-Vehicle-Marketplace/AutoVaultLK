import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfileView } from '../../infrastructure/database/entities/dealer-profile.view-entity';
import { EtlStageLog } from '../../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../infrastructure/database/entities/upload-job.entity';
import { VehicleDictionaryView } from '../../infrastructure/database/entities/vehicle-dictionary.view-entity';
import { EtlWorkerService } from '../../workers/etl-worker/etl-worker.service';
import { LocalOrchestrator } from '../../workers/etl-worker/local-orchestrator';
import { MarketplaceVehiclesWriteAdapter } from '../../workers/etl-worker/pipeline/persistence/marketplace-vehicles-write.adapter';
import { DealerProfileRepository } from './repositories/dealer-profile.repository';
import { DictionaryRepository } from './repositories/dictionary.repository';
import { EtlStageLogRepository } from './repositories/etl-stage-log.repository';
import { RejectedRecordRepository } from './repositories/rejected-record.repository';
import { UploadJobRepository } from './repositories/upload-job.repository';
import { IngestionController } from './controllers/ingestion.controller';
import { IngestionUploadService } from './services/ingestion-upload.service';

/**
 * Owns the write side of the `ingestion` schema.
 *
 * The controllers for POST /ingest/upload land here in a later phase; the
 * repositories are exported now so the ETL worker and the upload API can both
 * be built against a stable surface (the 0.3/0.4 handoff point).
 */
@Module({
  imports: [TypeOrmModule.forFeature([
      UploadJob,
      RejectedRecord,
      EtlStageLog,
      DealerProfileView,
      VehicleDictionaryView,
    ])],

  controllers: [
    IngestionController,
  ],
  providers: [
    UploadJobRepository,
    RejectedRecordRepository,
    EtlStageLogRepository,
    DealerProfileRepository,
    DictionaryRepository,
    // The ONE cross-schema write (ADR-002). Provided here rather than in a
    // pipeline module because it needs the DataSource; the orchestrator hands
    // it to the Load stage. Do not add a second writer — see its header.
    MarketplaceVehiclesWriteAdapter,
    // The ETL itself: EtlWorkerService binds the queue to the orchestrator at
    // boot (ADR-007). Under Step Functions the orchestrator is replaced by ASL
    // and the stages are called by Lambda wrappers instead.
    LocalOrchestrator,
    EtlWorkerService,
    IngestionUploadService,
  ],
  exports: [
    UploadJobRepository,
    RejectedRecordRepository,
    EtlStageLogRepository,
    DealerProfileRepository,
    DictionaryRepository,
    MarketplaceVehiclesWriteAdapter,
  ],
})
export class IngestionModule {}
