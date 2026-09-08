import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBJECT_STORE } from '../../infrastructure/ports/object-store.port';
import type { ObjectStore } from '../../infrastructure/ports/object-store.port';
import { DictionaryRepository } from '../../modules/ingestion/repositories/dictionary.repository';
import { EtlStageLogRepository } from '../../modules/ingestion/repositories/etl-stage-log.repository';
import { RejectedRecordRepository } from '../../modules/ingestion/repositories/rejected-record.repository';
import { UploadJobRepository } from '../../modules/ingestion/repositories/upload-job.repository';
import { pipelineConfig } from '../../config/pipeline.config';
import { mapWithConcurrency } from './pipeline/concurrency';
import { embedStage } from './pipeline/embed/embed.stage';
import { enrichStage } from './pipeline/enrich/enrich.stage';
import { groqNormalizeStage } from './pipeline/normalize/groq-normalize.stage';
import { parseNormalizeStage } from './pipeline/normalize/parse-normalize.stage';
import { splitChunksStage } from './pipeline/parse/split-chunks.stage';
import { createLoadStage } from './pipeline/persistence/load.stage';
import { MarketplaceVehiclesWriteAdapter } from './pipeline/persistence/marketplace-vehicles-write.adapter';
import {
  FileValidationError,
  validateFileStage,
} from './pipeline/validate/validate-file.stage';
import { validateRowsStage } from './pipeline/validate/validate-rows.stage';
import type {
  DictionarySnapshot,
  RawRow,
  Rejection,
  StageContext,
  StageLogger,
} from './pipeline/types';

/** Load is the only stage retried: a transient write failure is worth a retry. */
const LOAD_ATTEMPTS = 2;
const LOAD_RETRY_DELAY_MS = 250;

type ChunkOutcome = {
  chunkId: number;
  loaded: number;
  rejections: Rejection[];
  failed: boolean;
};

/**
 * Runs the ETL pipeline in-process, standing in for Step Functions (ADR-007).
 *
 * Transcribes the state machine in SAD §6.6 exactly: the stage decomposition,
 * the fan-out and its concurrency bound are the same, only the executor
 * differs. Deployment means writing thin Lambda wrappers around the same stage
 * objects and transcribing this flat graph into ASL — no stage function changes.
 *
 * **Chunk isolation is a correctness requirement, not resilience polish.** One
 * chunk failing must not fail the job: that is precisely what produces PARTIAL
 * rather than FAILED, and it is why every chunk runs inside its own error
 * boundary. A dealer whose 400th row breaks the embedder should still get 399
 * vehicles, not a rejected upload.
 */
@Injectable()
export class LocalOrchestrator {
  private readonly logger = new Logger(LocalOrchestrator.name);

  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly config: ConfigService,
    private readonly uploadJobs: UploadJobRepository,
    private readonly stageLogs: EtlStageLogRepository,
    private readonly rejectedRecords: RejectedRecordRepository,
    private readonly dictionary: DictionaryRepository,
    private readonly vehicles: MarketplaceVehiclesWriteAdapter,
  ) {}

  async run(jobId: string): Promise<void> {
    const job = await this.uploadJobs.findById(jobId);
    if (!job) {
      // Nothing to mark FAILED — the row the status would live on is the one
      // that is missing.
      this.logger.error(`Upload job ${jobId} not found; nothing to process`);
      return;
    }

    const log = this.stageLogs.forJob(jobId);
    await this.uploadJobs.updateStatus(jobId, 'PROCESSING');

    try {
      // Loaded once per run, never per row: the ETL holds a small pool under
      // MaxConcurrency 10, and per-row lookups would invalidate that sizing
      // (see InMemoryDictionarySnapshot's header).
      const snapshot = await this.dictionary.loadSnapshot();

      const { headers, chunkKeys, totalRecords } = await this.prepare(job.id, job, log);

      if (totalRecords === 0) {
        // A header-only file is not a failure — the dealer uploaded an empty
        // inventory. COMPLETED with zero counts is the honest outcome.
        await this.uploadJobs.updateCounts(jobId, { validRecords: 0, invalidRecords: 0 });
        await this.uploadJobs.updateStatus(jobId, 'COMPLETED');
        return;
      }

      void headers;

      const alreadyLoaded = await this.stageLogs.succeededChunks(jobId, 'LOAD');
      if (alreadyLoaded.size > 0) {
        this.logger.log(
          `Job ${jobId} resuming: skipping ${alreadyLoaded.size} chunk(s) already loaded`,
        );
      }

      const outcomes = await mapWithConcurrency(
        chunkKeys,
        pipelineConfig(this.config).maxConcurrency,
        (key, index) =>
          this.runChunk({
            jobId,
            dealerId: job.dealerId,
            chunkId: index,
            key,
            snapshot,
            log,
            skip: alreadyLoaded.has(index),
          }),
      );

      await this.finish(jobId, totalRecords, outcomes);
    } catch (err) {
      // Only whole-file failures reach here: validateFile rejecting the file,
      // or infrastructure being unavailable. Row and chunk problems are handled
      // below without ever throwing.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job ${jobId} failed: ${message}`);

      if (err instanceof FileValidationError) {
        await this.rejectedRecords.insertMany(jobId, [
          { rowNumber: 0, rawData: {}, reason: message },
        ]);
      }

      await this.uploadJobs.updateStatus(jobId, 'FAILED');
    }
  }

  /** validateFile then splitChunks — the whole-file stages. */
  private async prepare(
    jobId: string,
    job: { csvS3Path: string; fileName: string },
    log: StageLogger,
  ): Promise<{ headers: string[]; chunkKeys: string[]; totalRecords: number }> {
    const ctx = this.contextFor(jobId, '', null, undefined);

    const validateId = await log.start('VALIDATE_FILE', null);
    let validated: { headers: string[]; key: string };
    try {
      validated = await validateFileStage.run(ctx, {
        key: job.csvS3Path,
        fileName: job.fileName,
      });
      await log.finish(validateId, 'SUCCEEDED', {
        metrics: { columns: validated.headers.length },
      });
    } catch (err) {
      await log.finish(validateId, 'FAILED', { errorMessage: messageOf(err) });
      throw err;
    }

    const splitId = await log.start('SPLIT_CHUNKS', null);
    try {
      const split = await splitChunksStage.run(ctx, {
        key: validated.key,
        headers: validated.headers,
      });

      // Recorded before fan-out so a job that dies mid-flight still shows the
      // denominator the dealer's progress bar needs.
      await this.uploadJobs.updateTotal(jobId, split.totalRecords);
      await log.finish(splitId, 'SUCCEEDED', {
        metrics: { chunks: split.chunkKeys.length, rows: split.totalRecords },
      });

      return { headers: validated.headers, ...split };
    } catch (err) {
      await log.finish(splitId, 'FAILED', { errorMessage: messageOf(err) });
      throw err;
    }
  }

  /**
   * One chunk through the row stages. Never throws — a chunk that fails is
   * reported as `failed` so the job can still complete as PARTIAL.
   */
  private async runChunk(input: {
    jobId: string;
    dealerId: string;
    chunkId: number;
    key: string;
    snapshot: DictionarySnapshot;
    log: StageLogger;
    skip: boolean;
  }): Promise<ChunkOutcome> {
    const { jobId, dealerId, chunkId, key, snapshot, log, skip } = input;

    if (skip) {
      // Rows with a null registration number miss both partial indexes, so a
      // re-run would insert them twice. Skipping the chunk is what makes retry
      // idempotent for them — the database cannot deduplicate what it has no
      // key for.
      return { chunkId, loaded: 0, rejections: [], failed: false };
    }

    const ctx = this.contextFor(jobId, dealerId, chunkId, snapshot);
    const rejections: Rejection[] = [];

    try {
      const raw = JSON.parse((await this.store.get(key)).toString('utf8')) as RawRow[];

      const parsed = await this.runStage(log, 'PARSE_NORMALIZE', chunkId, async () => {
        const result = await parseNormalizeStage.run(ctx, raw);
        return { result, metrics: { rows: result.rows.length } };
      });

      const groq = await this.runStage(log, 'GROQ_NORMALIZE', chunkId, async () => {
        const result = await groqNormalizeStage.run(ctx, parsed.rows);
        return { result, metrics: result.metrics, status: result.outcome };
      });

      const validated = await this.runStage(log, 'VALIDATE_ROWS', chunkId, async () => {
        const result = await validateRowsStage.run(ctx, groq.rows);
        return {
          result,
          metrics: { valid: result.rows.length, rejected: result.rejections.length },
        };
      });
      rejections.push(...validated.rejections);

      const enriched = await this.runStage(log, 'ENRICH', chunkId, async () => {
        const result = await enrichStage.run(ctx, validated.rows);
        return { result, metrics: { rows: result.rows.length } };
      });

      const embedded = await this.runStage(log, 'EMBED', chunkId, async () => {
        const result = await embedStage.run(ctx, enriched.rows);
        return { result, metrics: result.metrics, status: result.outcome };
      });

      const loaded = await this.load(ctx, log, chunkId, embedded.rows);
      rejections.push(...loaded.rejections);

      // Written once per chunk rather than per stage: rejections from
      // validateRows and Load land in one statement, and a chunk that dies
      // before this point leaves no partial rejection set behind.
      await this.rejectedRecords.insertMany(jobId, rejections);

      return {
        chunkId,
        loaded: loaded.loaded.length,
        rejections,
        failed: false,
      };
    } catch (err) {
      // The isolation boundary. A chunk that throws is reported, not rethrown,
      // so the remaining chunks still run and the job can end PARTIAL.
      this.logger.error(`Chunk ${chunkId} of job ${jobId} failed: ${messageOf(err)}`);

      // Best-effort: a chunk that failed after validateRows still has real
      // rejections worth showing the dealer. If this write also fails, the
      // chunk is already lost — do not let it take the job with it.
      try {
        await this.rejectedRecords.insertMany(jobId, rejections);
      } catch {
        /* already failing; the outcome below is what matters */
      }

      return { chunkId, loaded: 0, rejections, failed: true };
    }
  }

  /**
   * Load, retried once. Alone among the stages because its failures are
   * typically transient — a dropped connection or a lock timeout — whereas a
   * stage that rejected a row will reject it identically on a second run.
   */
  private async load(
    ctx: StageContext,
    log: StageLogger,
    chunkId: number,
    rows: Parameters<ReturnType<typeof createLoadStage>['run']>[1],
  ) {
    const stage = createLoadStage(this.vehicles);
    let lastError: unknown;

    for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
      const logId = await log.start('LOAD', chunkId, attempt);
      try {
        const result = await stage.run(ctx, rows);
        await log.finish(logId, 'SUCCEEDED', {
          metrics: { loaded: result.loaded.length, rejected: result.rejections.length },
        });
        return result;
      } catch (err) {
        lastError = err;
        await log.finish(logId, 'FAILED', { errorMessage: messageOf(err) });
        if (attempt < LOAD_ATTEMPTS - 1) await delay(LOAD_RETRY_DELAY_MS);
      }
    }

    throw lastError;
  }

  /** Wraps one stage in start/finish logging, propagating the failure. */
  private async runStage<T>(
    log: StageLogger,
    stage: Parameters<StageLogger['start']>[0],
    chunkId: number,
    body: () => Promise<{
      result: T;
      metrics?: Record<string, unknown>;
      status?: 'SUCCEEDED' | 'SKIPPED' | 'DEGRADED';
    }>,
  ): Promise<T> {
    const logId = await log.start(stage, chunkId);
    try {
      const { result, metrics, status } = await body();
      await log.finish(logId, status ?? 'SUCCEEDED', { metrics });
      return result;
    } catch (err) {
      await log.finish(logId, 'FAILED', { errorMessage: messageOf(err) });
      throw err;
    }
  }

  /**
   * Final counts and terminal status.
   *
   * PARTIAL is the interesting case: any chunk failing, or any row rejected,
   * means the dealer got less than they uploaded and needs to know which rows.
   * FAILED is reserved for nothing landing at all.
   */
  private async finish(
    jobId: string,
    totalRecords: number,
    outcomes: ChunkOutcome[],
  ): Promise<void> {
    const anyFailed = outcomes.some((o) => o.failed);

    // Counted from the database, not from this run's outcomes. A resumed job
    // loads nothing new — its rows were written by the previous run — and
    // tallying only what happened here would report 0 loaded and downgrade a
    // finished job to FAILED on a harmless retry.
    const loaded = await this.vehicles.countForJob(jobId);
    const rejected = await this.rejectedRecords.countForJob(jobId);

    await this.uploadJobs.updateCounts(jobId, {
      validRecords: loaded,
      invalidRecords: rejected,
    });

    const status = loaded === 0 ? 'FAILED' : anyFailed || rejected > 0 ? 'PARTIAL' : 'COMPLETED';

    await this.uploadJobs.updateStatus(jobId, status);
    this.logger.log(
      `Job ${jobId} ${status}: ${loaded} loaded, ${rejected} rejected of ${totalRecords}`,
    );
  }

  private contextFor(
    jobId: string,
    dealerId: string,
    chunkId: number | null,
    snapshot: DictionarySnapshot | undefined,
  ): StageContext {
    return {
      jobId,
      dealerId,
      chunkId,
      store: this.store,
      // The whole-file stages never touch the dictionary; handing them a real
      // snapshot would only obscure that.
      dictionary: snapshot ?? UNAVAILABLE_DICTIONARY,
      config: pipelineConfig(this.config),
    };
  }
}

/**
 * Stand-in for the stages that run before the snapshot is needed. Throwing
 * rather than returning null: a stage reaching for the dictionary here is a
 * wiring mistake, and a silent null would surface much later as every row
 * failing to resolve.
 */
const UNAVAILABLE_DICTIONARY: DictionarySnapshot = {
  resolveMake: () => {
    throw new Error('Dictionary is not available to whole-file stages');
  },
  resolveModel: () => {
    throw new Error('Dictionary is not available to whole-file stages');
  },
  resolve: () => {
    throw new Error('Dictionary is not available to whole-file stages');
  },
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
