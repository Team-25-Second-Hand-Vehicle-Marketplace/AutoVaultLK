import { UploadJobStatus } from '../../../infrastructure/database/entities/upload-job.entity';

export class JobStatusResponseDto {
  id: string;

  status: UploadJobStatus;

  fileName: string;

  totalRecords: number;

  validRecords: number;

  invalidRecords: number;

  createdAt: Date;

  updatedAt: Date;
}
