import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EtlStageLog } from '../../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../infrastructure/database/entities/upload-job.entity';
import { EtlStageLogRepository } from '../ingestion/repositories/etl-stage-log.repository';
import { JwtAuthModule } from '../auth/jwt-auth.module';

import { JobStatusController } from './controllers/job-status.controller';
import { JobStatusService } from './services/job-status.service';
import { JobStatusRepository } from './repositories/job-status.repository';

@Module({
  imports: [
    JwtAuthModule,
    TypeOrmModule.forFeature([UploadJob, RejectedRecord, EtlStageLog]),
  ],
  controllers: [JobStatusController],
  providers: [JobStatusService, JobStatusRepository, EtlStageLogRepository],
})
export class JobStatusModule {}
