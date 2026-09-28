import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthUserView } from '../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../infrastructure/database/entities/dealer-profile.view-entity';
import { EtlStageLog } from '../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../infrastructure/database/entities/upload-job.entity';
import { VehicleDictionaryView } from '../infrastructure/database/entities/vehicle-dictionary.view-entity';
import { VehicleImageWriteEntity } from '../infrastructure/database/entities/vehicle-image.write-entity';
import { VehicleWriteEntity } from '../infrastructure/database/entities/vehicle.write-entity';

/**
 * ingestion-service owns the `ingestion` schema: upload_jobs,
 * rejected_records, etl_stage_logs.
 *
 * The ETL loader also writes marketplace.vehicles and
 * marketplace.vehicle_images directly — the one documented cross-schema
 * write exception (see database/src/grants.sql and
 * Documentation/plan-b-reads-cross-schemas.md §6). It also holds SELECT
 * on marketplace.vehicle_dictionaries (Option B reference data) and on
 * auth.users, for the same reasons.
 *
 * Note on pooling: loadFn is the only stage holding a write connection
 * within this service's ETL pipeline, and Step Functions' MaxConcurrency
 * of 10 is what bounds the pool. Keep `max` low here.
 */
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.INGESTION_DATABASE_URL,
  schema: 'ingestion',
  // Explicit classes, not a __dirname glob: a stage Lambda is esbuild's
  // single-file bundle, with no infrastructure/database/entities directory
  // on disk for a glob to resolve against, so it silently found zero
  // entities there and every query failed with EntityMetadataNotFoundError.
  entities: [
    AuthUserView,
    DealerProfileView,
    EtlStageLog,
    RejectedRecord,
    UploadJob,
    VehicleDictionaryView,
    VehicleImageWriteEntity,
    VehicleWriteEntity,
  ],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  // Opt-in TLS: RDS refuses non-SSL connections (rds.force_ssl), local Docker
  // Postgres serves no certificate. Set DATABASE_SSL=true in AWS only.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  extra: { max: 5 },
});
