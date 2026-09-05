import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { HealthModule } from './health/health.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { JobStatusModule } from './modules/job-status/job-status.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    // Infrastructure ports (@Global). Driver choice is env-driven and fails
    // loudly on an unimplemented value rather than falling back — ADR-007.
    StorageModule,
    QueueModule,
    HealthModule,
    JobStatusModule,

  ],
})
export class AppModule {}
