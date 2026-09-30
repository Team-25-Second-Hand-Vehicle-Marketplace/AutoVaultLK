import type { UploadJobStatus } from '../../../infrastructure/database/entities/upload-job.entity';

/**
 * One row of the dealer's upload history — the same aggregate counts
 * GET /jobs/{id} shows, without per-stage detail or storage paths a list view
 * has no use for.
 */
export class JobSummaryDto {
  id: string;

  status: UploadJobStatus;

  fileName: string;

  totalRecords: number;

  validRecords: number;

  invalidRecords: number;

  createdAt: Date;

  updatedAt: Date;
}

export class JobsResponseDto {
  items: JobSummaryDto[];

  total: number;

  page: number;

  limit: number;

  totalPages: number;
}
