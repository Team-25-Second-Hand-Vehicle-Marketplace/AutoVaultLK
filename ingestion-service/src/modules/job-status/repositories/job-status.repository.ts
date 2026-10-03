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
