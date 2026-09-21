import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RejectedRecord } from '../../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../../infrastructure/database/entities/upload-job.entity';

export type RejectionsPage = {
  rows: RejectedRecord[];
  total: number;
};

@Injectable()
export class JobStatusRepository {
  constructor(
    @InjectRepository(UploadJob)
    private readonly uploadJobRepository: Repository<UploadJob>,
    @InjectRepository(RejectedRecord)
    private readonly rejectedRecordRepository: Repository<RejectedRecord>,
  ) {}

  async findById(id: string, dealerId: string): Promise<UploadJob | null> {
    return this.uploadJobRepository.findOne({
      select: {
        id: true,
        status: true,
        fileName: true,
        totalRecords: true,
        validRecords: true,
        invalidRecords: true,
        createdAt: true,
        updatedAt: true,
      },
      where: { id, dealerId },
    });
  }

  /**
   * The rejected rows of one job, scoped to the dealer that owns it.
   *
   * **The dealer filter is part of this query, not a prior check.** Fetching
   * the job first and then its rejections would leave a window where a caller
   * who guesses a job id reads another dealer's rows if the ownership test is
   * ever moved, reordered or short-circuited. Joining through `upload_jobs` on
   * `dealer_id` makes a non-owner match zero rows by construction, which is the
   * same answer a missing job gives — see the 404-not-403 note on the service.
   *
   * Ordered by row number so the report reads in file order. `stage` breaks the
   * tie: row 0 is the whole-file rejection and several stages can each record
   * one, so without it the order of those rows is whatever Postgres returns.
   */
  async findRejectedRecords(
    uploadJobId: string,
    dealerId: string,
    page: number,
    limit: number,
  ): Promise<RejectionsPage> {
    const [rows, total] = await this.rejectedRecordRepository
      .createQueryBuilder('rejected')
      .innerJoin(
        UploadJob,
        'job',
        'job.id = rejected.upload_job_id AND job.dealer_id = :dealerId',
        { dealerId },
      )
      .where('rejected.upload_job_id = :uploadJobId', { uploadJobId })
      .orderBy('rejected.row_number', 'ASC')
      .addOrderBy('rejected.stage', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { rows, total };
  }
}
