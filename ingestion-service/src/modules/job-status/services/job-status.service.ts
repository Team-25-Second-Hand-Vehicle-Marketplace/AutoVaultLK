import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobStatusResponseDto } from '../dto/job-status-response.dto';
import { JobStatusRepository } from '../repositories/job-status.repository';

@Injectable()
export class JobStatusService {
  constructor(
    private readonly jobStatusRepository: JobStatusRepository,
  ) {}

  async getJobStatus(
    id: string,
    dealerId: string,
  ): Promise<JobStatusResponseDto> {
    const job = await this.jobStatusRepository.findById(id, dealerId);

    if (!job) {
      throw new NotFoundException(
        `Upload job with id ${id} not found`,
      );
    }

    return {
      id: job.id,
      status: job.status,
      fileName: job.fileName,
      totalRecords: job.totalRecords,
      validRecords: job.validRecords,
      invalidRecords: job.invalidRecords,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
