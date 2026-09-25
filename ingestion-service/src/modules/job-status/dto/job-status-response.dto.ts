import type { UploadJobStatus } from '../../../infrastructure/database/entities/upload-job.entity';
import type {
  EtlStage,
  EtlStageStatus,
} from '../../../infrastructure/database/entities/etl-stage-log.entity';

export class StageProgressDto {
  stage: EtlStage;

  status: EtlStageStatus;

  chunkId: number | null;

  retryCount: number;

  startedAt: Date | null;

  completedAt: Date | null;

  errorMessage: string | null;
}

export class JobStatusResponseDto {
  id: string;

  status: UploadJobStatus;

  fileName: string;

  totalRecords: number;

  validRecords: number;

  invalidRecords: number;

  createdAt: Date;

  updatedAt: Date;

  stages: StageProgressDto[];
}
