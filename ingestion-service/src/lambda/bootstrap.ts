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


async function connect(): Promise<DataSource> {
  const base = databaseConfig() as Record<string, unknown>;

  const dataSource = new DataSource({
    ...base,
    extra: {
      max: 1,

      idleTimeoutMillis: 120_000,

      connectionTimeoutMillis: 10_000,

      query_timeout: 55_000,
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
