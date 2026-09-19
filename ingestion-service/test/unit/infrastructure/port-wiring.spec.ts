import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JOB_QUEUE } from '../../../src/infrastructure/ports/job-queue.port';
import { OBJECT_STORE } from '../../../src/infrastructure/ports/object-store.port';
import { InProcessJobQueue } from '../../../src/infrastructure/queue/in-process-job-queue';
import { QueueModule } from '../../../src/infrastructure/queue/queue.module';
import { SqsJobQueue } from '../../../src/infrastructure/queue/sqs-job-queue';
import { LocalObjectStore } from '../../../src/infrastructure/storage/local-object-store';
import { S3ObjectStore } from '../../../src/infrastructure/storage/s3-object-store';
import { StorageModule } from '../../../src/infrastructure/storage/storage.module';

/**
 * The port modules resolve without a database, so DI can be checked here. The
 * full AppModule needs a live Postgres and belongs in the e2e suite.
 */
describe('infrastructure port wiring', () => {
  const build = (env: Record<string, string>) =>
    Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] }),
        StorageModule,
        QueueModule,
      ],
    }).compile();

  it('resolves the local drivers by default', async () => {
    const moduleRef = await build({});

    expect(moduleRef.get(OBJECT_STORE)).toBeInstanceOf(LocalObjectStore);
    expect(moduleRef.get(JOB_QUEUE)).toBeInstanceOf(InProcessJobQueue);

    await moduleRef.close();
  });

  // The ETL module calls setHandler on the concrete class. If the token
  // resolved to a different instance the handler would never fire, and every
  // upload would sit at PENDING forever.
  it('exposes InProcessJobQueue as the same instance behind JOB_QUEUE', async () => {
    const moduleRef = await build({ INGESTION_QUEUE_DRIVER: 'inprocess' });

    expect(moduleRef.get(JOB_QUEUE)).toBe(moduleRef.get(InProcessJobQueue));

    await moduleRef.close();
  });

  // Falling back to local disk when s3 was asked for would write dealer uploads
  // to storage that vanishes on the next cold start, with the job row still
  // claiming success. Now that the driver exists, the same fail-loud posture
  // applies to its configuration: an s3 driver with no bucket must not start.
  it('refuses the s3 driver when no bucket is configured', async () => {
    await expect(
      build({ INGESTION_STORAGE_DRIVER: 's3', INGESTION_S3_BUCKET: '' }),
    ).rejects.toThrow(/INGESTION_S3_BUCKET/);
  });

  it('builds the s3 driver when a bucket is configured', async () => {
    const moduleRef = await build({
      INGESTION_STORAGE_DRIVER: 's3',
      INGESTION_S3_BUCKET: 'test-bucket',
    });

    expect(moduleRef.get(OBJECT_STORE)).toBeInstanceOf(S3ObjectStore);
    await moduleRef.close();
  });

  it('refuses the sqs driver when no queue url is configured', async () => {
    await expect(
      build({ INGESTION_QUEUE_DRIVER: 'sqs', INGESTION_SQS_QUEUE_URL: '' }),
    ).rejects.toThrow(/INGESTION_SQS_QUEUE_URL/);
  });

  it('builds the sqs driver when a queue url is configured', async () => {
    const moduleRef = await build({
      INGESTION_QUEUE_DRIVER: 'sqs',
      INGESTION_SQS_QUEUE_URL:
        'https://sqs.ap-southeast-1.amazonaws.com/123456789012/ingestion-jobs',
    });

    expect(moduleRef.get(JOB_QUEUE)).toBeInstanceOf(SqsJobQueue);
    await moduleRef.close();
  });

  it.each([['nfs'], ['S3'], ['gcs']])(
    'rejects unknown storage driver %j',
    async (driver) => {
      await expect(build({ INGESTION_STORAGE_DRIVER: driver })).rejects.toThrow(
        /Unknown INGESTION_STORAGE_DRIVER/,
      );
    },
  );

  it.each([['kafka'], ['SQS']])('rejects unknown queue driver %j', async (driver) => {
    await expect(build({ INGESTION_QUEUE_DRIVER: driver })).rejects.toThrow(
      /Unknown INGESTION_QUEUE_DRIVER/,
    );
  });
});
