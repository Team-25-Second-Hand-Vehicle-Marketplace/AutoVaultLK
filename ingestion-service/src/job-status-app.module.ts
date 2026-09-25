import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { HealthModule } from './health/health.module';
import { JobStatusModule } from './modules/job-status/job-status.module';

/**
 * The job-status-api Lambda's own module, separate from AppModule.
 *
 * The full design (SAD §6.6) deploys ingest-api and job-status-api as two
 * Lambdas. AppModule (used by ingest-api.ts) stays combined rather than being
 * split, to avoid touching the local/Docker path and existing tests that boot
 * it expecting both route sets — this module exists purely so job-status-api
 * has something slimmer to boot: no QueueModule/StorageModule/IngestionModule,
 * since job-status never touches the upload queue or object store.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    HealthModule,
    JobStatusModule,
  ],
})
export class JobStatusAppModule {}
