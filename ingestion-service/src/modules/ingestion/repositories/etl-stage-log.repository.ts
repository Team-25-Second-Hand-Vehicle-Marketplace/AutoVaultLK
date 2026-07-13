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

  /** Every stage log for a job, oldest first - feeds job-status progress. */
  async findForJob(uploadJobId: string): Promise<EtlStageLog[]> {
    return this.repo.find({
      where: { uploadJobId },
      order: { startedAt: 'ASC', chunkId: 'ASC' },
    });
  }

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
