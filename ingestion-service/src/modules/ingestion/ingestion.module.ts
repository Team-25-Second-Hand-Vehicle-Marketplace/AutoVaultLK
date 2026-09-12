import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfileView } from '../../infrastructure/database/entities/dealer-profile.view-entity';
import { EtlStageLog } from '../../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../infrastructure/database/entities/upload-job.entity';
import { VehicleImageWriteEntity } from '../../infrastructure/database/entities/vehicle-image.write-entity';
import { VehicleDictionaryView } from '../../infrastructure/database/entities/vehicle-dictionary.view-entity';
import { VehicleWriteEntity } from '../../infrastructure/database/entities/vehicle.write-entity';
import { EtlWorkerService } from '../../workers/etl-worker/etl-worker.service';
import { LocalOrchestrator } from '../../workers/etl-worker/local-orchestrator';
import { ProcessJobImagesService } from '../../workers/etl-worker/pipeline/image-processing/process-job-images.service';
import { VehicleImageRepository } from '../../workers/etl-worker/pipeline/image-processing/vehicle-image.repository';
import { MarketplaceVehicleImagesWriteAdapter } from '../../workers/etl-worker/pipeline/persistence/marketplace-vehicle-images-write.adapter';
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
  imports: [
    TypeOrmModule.forFeature([
      UploadJob,
      RejectedRecord,
      EtlStageLog,
      DealerProfileView,
      VehicleDictionaryView,
      VehicleWriteEntity,
      VehicleImageWriteEntity,
    ]),
  ],

  controllers: [IngestionController],
  providers: [
    UploadJobRepository,
    RejectedRecordRepository,
    EtlStageLogRepository,
    DealerProfileRepository,
    DictionaryRepository,
    VehicleImageRepository,
    ProcessJobImagesService,
    // The ONE cross-schema write (ADR-002). Provided here rather than in a
    // pipeline module because it needs the DataSource; the orchestrator hands
    // it to the Load stage. Do not add a second writer — see its header.
    MarketplaceVehiclesWriteAdapter,
    // The image half of the same ADR-002 exception. B3 injects this rather
    // than writing marketplace.vehicle_images directly.
    MarketplaceVehicleImagesWriteAdapter,
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
    VehicleImageRepository,
    ProcessJobImagesService,
    MarketplaceVehiclesWriteAdapter,
    MarketplaceVehicleImagesWriteAdapter,
  ],
})
export class IngestionModule {}
