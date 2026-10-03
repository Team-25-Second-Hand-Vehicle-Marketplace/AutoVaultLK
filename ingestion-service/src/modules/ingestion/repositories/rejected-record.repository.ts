import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';
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

  async insertMany(
    uploadJobId: string,
    stage: EtlStage,
    rejections: Rejection[],
  ): Promise<void> {
    if (rejections.length === 0) return;

    // Two partial unique indexes cover this table (migration 26000): row 0 is
    // the whole-file rejection and keys on (job, stage) alone, everything else
    // keys on (job, stage, row_number). A batch mixing the two would need two
    // different conflict targets in one statement, which Postgres cannot
    // express - so they are written separately.
    const fileLevel = rejections.filter((r) => r.rowNumber === 0);
    const rowLevel = rejections.filter((r) => r.rowNumber > 0);

    await this.upsert(uploadJobId, stage, rowLevel, 'row');
    await this.upsert(uploadJobId, stage, fileLevel, 'file');
  }

  private async upsert(
    uploadJobId: string,
    stage: EtlStage,
    rejections: Rejection[],
    target: 'row' | 'file',
  ): Promise<void> {
    if (rejections.length === 0) return;

    const conflict =
      target === 'row'
        ? '(upload_job_id, stage, row_number) WHERE row_number > 0'
        : '(upload_job_id, stage) WHERE row_number = 0';

    for (let i = 0; i < rejections.length; i += INSERT_BATCH) {
      const batch = rejections.slice(i, i + INSERT_BATCH);

      const values: string[] = [];
      const params: unknown[] = [];

      for (const r of batch) {
        const n = params.length;
        params.push(uploadJobId, stage, r.rowNumber, JSON.stringify(r.rawData), r.reason);
        values.push(`($${n + 1}, $${n + 2}, $${n + 3}, $${n + 4}::jsonb, $${n + 5})`);
      }

      await this.repo.query(
        `INSERT INTO ingestion.rejected_records
           (upload_job_id, stage, row_number, raw_data, reason)
         VALUES ${values.join(', ')}
         ON CONFLICT ${conflict}
         DO UPDATE SET raw_data = EXCLUDED.raw_data, reason = EXCLUDED.reason`,
        params,
      );
    }
  }

  async countForJob(uploadJobId: string): Promise<number> {
    return this.repo.count({ where: { uploadJobId } });
  }

  /** Paginated for GET /jobs/{id} - a bad upload can reject thousands of rows. */
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
