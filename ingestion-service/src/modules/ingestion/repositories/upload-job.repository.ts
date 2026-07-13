import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UploadJob,
  type UploadFileFormat,
  type UploadJobStatus,
} from '../../../infrastructure/database/entities/upload-job.entity';

export type CreateUploadJobInput = {
  dealerId: string;
  fileName: string;
  csvS3Path: string;
  zipS3Path?: string | null;
  /** Defaults to 'csv' (the pre-JSON behaviour) for callers that omit it. */
  fileFormat?: UploadFileFormat;
};

export type UploadJobPage = {
  items: UploadJob[];
  total: number;
};

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
        fileFormat: input.fileFormat ?? 'csv',
        status: 'PENDING',
        totalRecords: 0,
        validRecords: 0,
        invalidRecords: 0,
      }),
    );
  }

  /** Unscoped - pipeline use only. Dealer-facing reads go through JobStatusRepository. */
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

  async updateStoragePaths(
    id: string,
    csvS3Path: string,
    zipS3Path: string | null,
  ): Promise<void> {
    await this.repo.update(
      { id },
      {
        csvS3Path,
        zipS3Path,
      },
    );
  }
}
