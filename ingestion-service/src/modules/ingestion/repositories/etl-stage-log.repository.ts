import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EtlStageLog,
  type EtlStage,
  type EtlStageStatus,
} from '../../../infrastructure/database/entities/etl-stage-log.entity';
import type { StageLogger } from '../../../workers/etl-worker/pipeline/types';

/** error_message is `text`, but a full stack on every row helps nobody. */
const MAX_ERROR_LENGTH = 2000;

/**
 * Writes ingestion.etl_stage_logs — the per-stage, per-chunk audit trail that
 * GET /jobs/{id} reports progress from.
 *
 * `forJob` yields a StageLogger bound to one upload job, so pipeline stages log
 * transitions without importing TypeORM or threading the job id through every
 * call (ADR-007: stages stay framework-free).
 */
@Injectable()
export class EtlStageLogRepository {
  constructor(
    @InjectRepository(EtlStageLog)
    private readonly repo: Repository<EtlStageLog>,
  ) {}

  /** A StageLogger scoped to one job. Satisfies the StageLoggerFactory type. */
  forJob(uploadJobId: string): StageLogger {
    return {
      start: (stage, chunkId, retryCount) =>
        this.start(uploadJobId, stage, chunkId, retryCount),
      finish: (logId, status, detail) => this.finish(logId, status, detail),
    };
  }

  async start(
    uploadJobId: string,
    stage: EtlStage,
    chunkId: number | null,
    retryCount = 0,
  ): Promise<string> {
    const log = await this.repo.save(
      this.repo.create({
        uploadJobId,
        stage,
        status: 'STARTED' satisfies EtlStageStatus,
        chunkId,
        retryCount,
        startedAt: new Date(),
      }),
    );

    return log.id;
  }

  async finish(
    logId: string,
    status: Exclude<EtlStageStatus, 'STARTED'>,
    detail?: { metrics?: Record<string, unknown>; errorMessage?: string },
  ): Promise<void> {
    await this.repo.update(
      { id: logId },
      {
        status,
        completedAt: new Date(),
        // Same jsonb/QueryDeepPartialEntity friction as rejected_records.raw_data;
        // the value is written verbatim.
        metrics: (detail?.metrics ?? {}) as EtlStageLog['metrics'] & object,
        errorMessage: detail?.errorMessage
          ? detail.errorMessage.slice(0, MAX_ERROR_LENGTH)
          : null,
      },
    );
  }

  /** Every stage log for a job, oldest first — feeds job-status progress. */
  async findForJob(uploadJobId: string): Promise<EtlStageLog[]> {
    return this.repo.find({
      where: { uploadJobId },
      order: { startedAt: 'ASC', chunkId: 'ASC' },
    });
  }

  /**
   * Chunk ids whose given stage already SUCCEEDED.
   *
   * The orchestrator skips these on a retry. That matters most for LOAD: rows
   * carrying a registration number are protected by the partial unique index on
   * (upload_job_id, registration_number), so re-running upserts them harmlessly
   * — but rows with a NULL registration number (legitimate for unregistered
   * imports) match no unique index and would be inserted a second time. Skipping
   * already-succeeded chunks is what makes a retry idempotent for those rows.
   */
  async succeededChunks(uploadJobId: string, stage: EtlStage): Promise<Set<number>> {
    const rows = await this.repo.find({
      where: { uploadJobId, stage, status: 'SUCCEEDED' },
      select: { chunkId: true },
    });

    return new Set(
      rows.map((row) => row.chunkId).filter((id): id is number => id !== null),
    );
  }
}
