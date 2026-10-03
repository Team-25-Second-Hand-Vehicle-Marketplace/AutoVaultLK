import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { RejectedRecord } from '../../../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../../infrastructure/database/entities/upload-job.entity';

export type RejectionsPage = {
  rows: RejectedRecord[];
  total: number;
};

export type JobsPage = {
  rows: UploadJob[];
  total: number;
};

/**
 * A job that has shown no sign of life for this long is not "active", whatever
 * its status says. A worker that is restarted or killed mid-run never writes
 * the terminal status, and without this the dealer would be sent back to that
 * job's page forever and could not start another upload.
 */
export const ACTIVE_JOB_STALE_AFTER_MS = 30 * 60 * 1000;

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
   * The dealer's own most recent job that has not settled yet, if any.
   *
   * Lets the Bulk Upload page notice "you already have one running" on load
   * rather than showing a blank form a dealer could resubmit into - a dealer
   * who submits, navigates away mid-processing, and comes back otherwise has
   * no way back to that job's status short of the URL they were on.
   *
   * Jobs untouched for ACTIVE_JOB_STALE_AFTER_MS are ignored: see that constant.
   */
  async findLatestActiveForDealer(dealerId: string): Promise<UploadJob | null> {
    const freshSince = new Date(Date.now() - ACTIVE_JOB_STALE_AFTER_MS);
    return this.uploadJobRepository.findOne({
      select: { id: true },
      where: [
        { dealerId, status: 'PENDING', updatedAt: MoreThan(freshSince) },
        { dealerId, status: 'PROCESSING', updatedAt: MoreThan(freshSince) },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * The dealer's own upload history, newest first - lets a dealer find a past
   * job's rejection report again after navigating away. Before this there was
   * no way back to a settled job's page short of the URL from right after it
   * finished; `getActiveJob` only ever covers the one still running.
   */
  async findByDealer(
    dealerId: string,
    page: number,
    limit: number,
  ): Promise<JobsPage> {
    const [rows, total] = await this.uploadJobRepository.findAndCount({
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
      where: { dealerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { rows, total };
  }

  /**
   * The rejected rows of one job, scoped to the dealer that owns it.
   *
   * **The dealer filter is part of this query, not a prior check.** Fetching
   * the job first and then its rejections would leave a window where a caller
   * who guesses a job id reads another dealer's rows if the ownership test is
   * ever moved, reordered or short-circuited. Joining through `upload_jobs` on
   * `dealer_id` makes a non-owner match zero rows by construction, which is the
   * same answer a missing job gives - see the 404-not-403 note on the service.
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
      // Entity property names (rowNumber), not the DB column (row_number):
      // TypeORM's join+pagination combining pass needs the property name to
      // resolve each order-by expression back to entity metadata, and throws
      // ("Cannot read properties of undefined (reading 'databaseName')")
      // deep in SelectQueryBuilder when given the raw column name instead.
      .orderBy('rejected.rowNumber', 'ASC')
      .addOrderBy('rejected.stage', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { rows, total };
  }
}
