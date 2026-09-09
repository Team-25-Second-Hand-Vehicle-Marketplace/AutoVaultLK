import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { databaseConfig } from '../config/database.config';
import { pipelineConfig } from '../config/pipeline.config';
import { EtlStageLog } from '../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../infrastructure/database/entities/upload-job.entity';
import { VehicleDictionaryView } from '../infrastructure/database/entities/vehicle-dictionary.view-entity';
import type { ObjectStore } from '../infrastructure/ports/object-store.port';
import { S3ObjectStore } from '../infrastructure/storage/s3-object-store';
import { LocalObjectStore } from '../infrastructure/storage/local-object-store';
import { DictionaryRepository } from '../modules/ingestion/repositories/dictionary.repository';
import { EtlStageLogRepository } from '../modules/ingestion/repositories/etl-stage-log.repository';
import { RejectedRecordRepository } from '../modules/ingestion/repositories/rejected-record.repository';
import { UploadJobRepository } from '../modules/ingestion/repositories/upload-job.repository';
import { MarketplaceVehiclesWriteAdapter } from '../workers/etl-worker/pipeline/persistence/marketplace-vehicles-write.adapter';
import type { DictionarySnapshot, StageContext } from '../workers/etl-worker/pipeline/types';

/**
 * Per-container wiring for the stage Lambdas.
 *
 * **Deliberately not a Nest application context.** Booting Nest costs several
 * hundred milliseconds on every cold start to build a DI graph a stage cannot
 * use anyway — stages take a StageContext, not injected providers. This
 * constructs the five things a stage actually needs and nothing else.
 *
 * Everything here is cached at module scope, so a warm container pays for it
 * once. Lambda freezes the process between invocations rather than tearing it
 * down, which is what makes that safe: the DataSource's socket survives, and
 * the dictionary snapshot with it.
 */

let cached: LambdaContext | undefined;

export type LambdaContext = {
  dataSource: DataSource;
  store: ObjectStore;
  dictionary: DictionarySnapshot;
  uploadJobs: UploadJobRepository;
  stageLogs: EtlStageLogRepository;
  rejections: RejectedRecordRepository;
  vehicles: MarketplaceVehiclesWriteAdapter;
};

/**
 * Reads configuration straight from process.env.
 *
 * `pipelineConfig` and `databaseConfig` are typed against ConfigService but
 * only ever call `.get(key)`, so this satisfies them structurally without
 * dragging @nestjs/config's module system into a Lambda.
 */
const env = {
  get: <T = string>(key: string): T | undefined => process.env[key] as T | undefined,
} as unknown as ConfigService;

export async function getContext(): Promise<LambdaContext> {
  if (cached) return cached;

  const dataSource = await connect();

  // Local driver kept reachable so a handler can be exercised against the
  // filesystem before a bucket exists. Production sets s3.
  const store =
    (process.env.INGESTION_STORAGE_DRIVER ?? 'local') === 's3'
      ? new S3ObjectStore(env)
      : new LocalObjectStore(env);

  const dictionaries = new DictionaryRepository(dataSource.getRepository(VehicleDictionaryView));

  cached = {
    dataSource,
    store,
    // Loaded once per container, not once per invocation. 177 rows in ~16ms is
    // cheap, but a Map state running 10 chunks × 6 stages would otherwise pay
    // it 60 times per job for data that changes when someone re-seeds.
    dictionary: await dictionaries.loadSnapshot(),
    uploadJobs: new UploadJobRepository(dataSource.getRepository(UploadJob)),
    stageLogs: new EtlStageLogRepository(dataSource.getRepository(EtlStageLog)),
    rejections: new RejectedRecordRepository(dataSource.getRepository(RejectedRecord)),
    vehicles: new MarketplaceVehiclesWriteAdapter(dataSource),
  };

  return cached;
}

/**
 * One connection per container, not five.
 *
 * A Lambda handles a single invocation at a time, so a pool has nothing to
 * pool — but each concurrent execution is its own container with its own pool.
 * At MaxConcurrency 10 the default `max: 5` would be 50 connections for one
 * job, and 150 for three dealers uploading at once, against a Postgres
 * `max_connections` that defaults to 100.
 *
 * This alone is not enough at scale; RDS Proxy is the other half (plan §S6).
 */
async function connect(): Promise<DataSource> {
  const base = databaseConfig() as Record<string, unknown>;

  const dataSource = new DataSource({
    ...base,
    extra: {
      max: 1,

      // Lambda freezes the process between invocations rather than tearing it
      // down, so a socket can sit idle for minutes and still be reused. Long
      // enough that a warm container does not reconnect on every request;
      // short enough that an abandoned container releases its slot rather than
      // holding one until the platform reaps it.
      idleTimeoutMillis: 120_000,

      // Fail fast rather than burning the invocation's whole timeout waiting.
      // Under RDS Proxy a borrow that takes this long means the proxy's own
      // pool is exhausted, and a retry with backoff is a better answer than a
      // Lambda that times out holding a pending connection.
      connectionTimeoutMillis: 10_000,

      // A query that hangs holds the container's only connection for the whole
      // invocation and, under RDS Proxy, a backend connection with it. Bounded
      // below the shortest Lambda timeout so the query dies before the
      // function does, leaving a clean connection rather than an orphaned one.
      statement_timeout: 55_000,
    },
  } as never);

  await dataSource.initialize();
  return dataSource;
}

/** Builds the per-chunk context a stage receives. */
export function stageContext(
  ctx: LambdaContext,
  input: { jobId: string; dealerId: string; chunkId: number | null },
): StageContext {
  return {
    jobId: input.jobId,
    dealerId: input.dealerId,
    chunkId: input.chunkId,
    store: ctx.store,
    dictionary: ctx.dictionary,
    config: pipelineConfig(env),
  };
}

/**
 * Test seam. Lambda never calls this — a container is discarded, not reset —
 * but a test asserting cold-start behaviour needs to clear the cache.
 */
export function __resetContext(): void {
  cached = undefined;
}
