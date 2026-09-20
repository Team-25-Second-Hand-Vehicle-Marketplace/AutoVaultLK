import { Injectable, NotFoundException } from '@nestjs/common';
import type { RejectedRecord } from '../../../infrastructure/database/entities/rejected-record.entity';
import { JobStatusResponseDto } from '../dto/job-status-response.dto';
import {
  DEFAULT_REJECTIONS_PAGE_SIZE,
  RejectionsQueryDto,
} from '../dto/rejections-query.dto';
import type {
  RejectedRecordDto,
  RejectionsResponseDto,
} from '../dto/rejections-response.dto';
import { JobStatusRepository } from '../repositories/job-status.repository';

/**
 * Columns of the dealer's own row echoed back per rejection. A rejection report
 * exists to point at the value that needs correcting, and the first columns of
 * the template carry the identifying ones (registration, make, model, year); a
 * 60-column export would otherwise make the response mostly payload the dealer
 * never reads.
 */
const RAW_DATA_MAX_KEYS = 24;

@Injectable()
export class JobStatusService {
  constructor(private readonly jobStatusRepository: JobStatusRepository) {}

  async getJobStatus(
    id: string,
    dealerId: string,
  ): Promise<JobStatusResponseDto> {
    const job = await this.jobStatusRepository.findById(id, dealerId);

    if (!job) {
      throw new NotFoundException(`Upload job with id ${id} not found`);
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

  /**
   * FR-57: the row-level half of the dealer's upload report.
   *
   * A job with no rejections is an empty page, not a 404 — a clean upload is
   * the expected case, and 404 here would read as "your job is gone". The 404
   * is reserved for a job that is not the caller's or does not exist, and the
   * ownership check is the same dealer-scoped query the rows come from, so
   * both answers are indistinguishable to a caller probing ids.
   */
  async getRejectedRecords(
    id: string,
    dealerId: string,
    query: RejectionsQueryDto,
  ): Promise<RejectionsResponseDto> {
    const job = await this.jobStatusRepository.findById(id, dealerId);

    if (!job) {
      throw new NotFoundException(`Upload job with id ${id} not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_REJECTIONS_PAGE_SIZE;

    const { rows, total } = await this.jobStatusRepository.findRejectedRecords(
      id,
      dealerId,
      page,
      limit,
    );

    return {
      items: rows.map((row) => toDto(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

function toDto(row: RejectedRecord): RejectedRecordDto {
  const { rawData, truncated } = capRawData(row.rawData);

  return {
    rowNumber: row.rowNumber,
    stage: row.stage,
    reason: row.reason,
    rawData,
    rawDataTruncated: truncated,
    createdAt: row.createdAt,
  };
}

function capRawData(rawData: Record<string, unknown> | null): {
  rawData: Record<string, unknown>;
  truncated: boolean;
} {
  if (!rawData) return { rawData: {}, truncated: false };

  const keys = Object.keys(rawData);
  if (keys.length <= RAW_DATA_MAX_KEYS) {
    return { rawData, truncated: false };
  }

  const capped: Record<string, unknown> = {};
  for (const key of keys.slice(0, RAW_DATA_MAX_KEYS)) {
    capped[key] = rawData[key];
  }

  return { rawData: capped, truncated: true };
}
