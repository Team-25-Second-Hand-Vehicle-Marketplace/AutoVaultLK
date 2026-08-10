import { TypeOrmModuleOptions } from '@nestjs/typeorm';

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
  entities: [
    __dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.view-entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.write-entity{.ts,.js}',
  ],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  extra: { max: 5 },
});
