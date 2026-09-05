import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UploadJob,
  type UploadJobStatus,
} from '../../../infrastructure/database/entities/upload-job.entity';

export type CreateUploadJobInput = {
  dealerId: string;
  fileName: string;
  csvS3Path: string;
  zipS3Path?: string | null;
};

export type UploadJobPage = {
  items: UploadJob[];
  total: number;
};

/**
 * Write-side access to ingestion.upload_jobs, used by the Ingest API and the
 * ETL pipeline.
 *
 * Distinct from JobStatusRepository, which is read-only and always scoped to
 * the owning dealer for GET /jobs/{id}. Keeping them apart means a dealer-facing
 * read can never accidentally reach a method that mutates job state.
 */
@Injectable()
export class UploadJobRepository {
  constructor(
    @InjectRepository(UploadJob)
    private readonly repo: Repository<UploadJob>,
  ) {}

  /**
   * Counts start at zero and status at PENDING; splitChunks sets the total once
   * it knows the row count, and the aggregate stage sets valid/invalid at the
   * end. Nothing here trusts a caller-supplied count.
   */
  async create(input: CreateUploadJobInput): Promise<UploadJob> {
    return this.repo.save(
      this.repo.create({
        dealerId: input.dealerId,
        fileName: input.fileName,
        csvS3Path: input.csvS3Path,
        zipS3Path: input.zipS3Path ?? null,
        status: 'PENDING',
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
      }),
    );
  }

  /** Unscoped — pipeline use only. Dealer-facing reads go through JobStatusRepository. */
  async findById(id: string): Promise<UploadJob | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByDealer(dealerId: string, limit = 20, offset = 0): Promise<UploadJobPage> {
    const [items, total] = await this.repo.findAndCount({
      where: { dealerId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }

  async updateStatus(id: string, status: UploadJobStatus): Promise<void> {
    await this.repo.update({ id }, { status });
  }

  /** Set by splitChunks once the file has been parsed and counted. */
  async updateTotal(id: string, totalRecords: number): Promise<void> {
    await this.repo.update({ id }, { totalRecords });
  }

  /**
   * Called once by the aggregate stage with the final tallies. Deliberately a
   * whole-value write rather than a per-chunk increment: chunks run
   * concurrently, so incrementing would need row locking to stay correct.
   */
  async updateCounts(
    id: string,
    counts: { validRecords: number; invalidRecords: number },
  ): Promise<void> {
    await this.repo.update({ id }, counts);
  }
}
