import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UploadJob } from '../../infrastructure/database/entities/upload-job.entity';
import { JwtAuthModule } from '../auth/jwt-auth.module';

import { JobStatusController } from './controllers/job-status.controller';
import { JobStatusService } from './services/job-status.service';
import { JobStatusRepository } from './repositories/job-status.repository';

@Module({
  imports: [
    JwtAuthModule,
    TypeOrmModule.forFeature([UploadJob]),
  ],
  controllers: [
    JobStatusController,
  ],
  providers: [
    JobStatusService,
    JobStatusRepository,
  ],
})
export class JobStatusModule {}
