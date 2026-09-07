import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { RejectedRecord } from '../../../infrastructure/database/entities/rejected-record.entity';
import type { Rejection } from '../../../workers/etl-worker/pipeline/types';

/**
 * Rows per INSERT. A chunk is INGESTION_CHUNK_SIZE (default 250), so in
 * practice a chunk's rejections are one statement; the batching matters only
 * for a pathological file where nearly every row fails.
 */
const INSERT_BATCH = 500;

@Injectable()
export class RejectedRecordRepository {
  constructor(
    @InjectRepository(RejectedRecord)
    private readonly repo: Repository<RejectedRecord>,
  ) {}

  /**
   * Reasons must already be clamped to varchar(500) — use the `rejection()`
   * helper in pipeline/types.ts rather than building the object by hand, or an
   * over-long message throws here and takes the whole chunk's rejections
   * with it.
   */
  async insertMany(uploadJobId: string, rejections: Rejection[]): Promise<void> {
    if (rejections.length === 0) return;

    for (let i = 0; i < rejections.length; i += INSERT_BATCH) {
      // TypeORM maps a jsonb Record<string, unknown> column to a deep-partial
      // of itself, which an arbitrary object does not satisfy. The value is
      // written verbatim; the annotation exists only to satisfy the insert()
      // overload, so it stays at this boundary rather than loosening the entity.
      const batch: QueryDeepPartialEntity<RejectedRecord>[] = rejections
        .slice(i, i + INSERT_BATCH)
        .map((r) => ({
          uploadJobId,
          rowNumber: r.rowNumber,
          rawData: r.rawData as QueryDeepPartialEntity<Record<string, unknown>>,
          reason: r.reason,
        }));

      await this.repo.insert(batch);
    }
  }

  async countForJob(uploadJobId: string): Promise<number> {
    return this.repo.count({ where: { uploadJobId } });
  }

  /** Paginated for GET /jobs/{id} — a bad upload can reject thousands of rows. */
  async findForJob(
    uploadJobId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ items: RejectedRecord[]; total: number }> {
    const [items, total] = await this.repo.findAndCount({
      where: { uploadJobId },
      order: { rowNumber: 'ASC' },
      take: limit,
      skip: offset,
    });

    return { items, total };
  }
}
