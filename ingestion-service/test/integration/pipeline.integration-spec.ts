import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { EtlStageLog } from '../../src/infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../src/infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../src/infrastructure/database/entities/upload-job.entity';
import { VehicleDictionaryView } from '../../src/infrastructure/database/entities/vehicle-dictionary.view-entity';
import { LocalObjectStore } from '../../src/infrastructure/storage/local-object-store';
import { DictionaryRepository } from '../../src/modules/ingestion/repositories/dictionary.repository';
import { EtlStageLogRepository } from '../../src/modules/ingestion/repositories/etl-stage-log.repository';
import { RejectedRecordRepository } from '../../src/modules/ingestion/repositories/rejected-record.repository';
import { UploadJobRepository } from '../../src/modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from '../../src/workers/etl-worker/local-orchestrator';
import { __setEmbedder } from '../../src/workers/etl-worker/pipeline/embed/embed.stage';
import { MarketplaceVehiclesWriteAdapter } from '../../src/workers/etl-worker/pipeline/persistence/marketplace-vehicles-write.adapter';
import { cleanup, connect, describeWithDatabase, disconnect, findDealer } from './test-database';

const HEADER = 'registration_number,make,model,year,price,mileage,fuel_type,transmission,body_type';

/** Unique per run so a crashed test cannot collide with the next. */
const run = String(Date.now()).slice(-6);
const plate = (n: number): string => `PL${run}-${n}`;

const good = (n: number): string =>
  `${plate(n)},Toyota,Vitz,2015,3500000,45000,Petrol,Automatic,Hatchback`;

describeWithDatabase('LocalOrchestrator (integration)', () => {
  let ds: DataSource;
  let orchestrator: LocalOrchestrator;
  let uploadJobs: UploadJobRepository;
  let storageRoot: string;
  let store: LocalObjectStore;
  let dealerId: string;
  const jobs: string[] = [];

  /** Writes a CSV to the store and creates the job that points at it. */
  const upload = async (csv: string): Promise<string> => {
    const job = await uploadJobs.create({
      dealerId,
      fileName: 'integration.csv',
      csvS3Path: 'pending',
    });
    jobs.push(job.id);

    const key = `raw/${job.id}/integration.csv`;
    await store.put(key, csv);
    await ds.query(`UPDATE ingestion.upload_jobs SET csv_s3_path = $1 WHERE id = $2`, [
      key,
      job.id,
    ]);

    return job.id;
  };

  const jobRow = async (jobId: string) => {
    const [r] = (await ds.query(
      `SELECT status, total_records, valid_records, invalid_records
         FROM ingestion.upload_jobs WHERE id = $1`,
      [jobId],
    )) as Record<string, unknown>[];
    return r;
  };

  beforeAll(async () => {
    const connected = await connect();
    if (!connected) throw new Error('Database unreachable despite the reachability probe');
    ds = connected;
    dealerId = await findDealer(ds);

    // The real MiniLM model is ~90MB and would dominate the runtime. The
    // embedding path itself is covered by the adapter spec's vector_dims
    // assertion; what this suite exercises is the orchestration around it.
    __setEmbedder({ embed: async () => Array(384).fill(0.1) } as never);

    storageRoot = mkdtempSync(join(tmpdir(), 'ingestion-integration-'));

    const config = {
      get: (key: string) =>
        key === 'INGESTION_STORAGE_ROOT' ? storageRoot : undefined,
    };

    store = new LocalObjectStore(config as never);

    // Repositories built on raw TypeORM repositories rather than through Nest:
    // the point is to exercise real SQL, and a testing module would add a
    // container without adding coverage.
    uploadJobs = new UploadJobRepository(ds.getRepository(UploadJob));
    orchestrator = new LocalOrchestrator(
      store,
      config as never,
      uploadJobs,
      new EtlStageLogRepository(ds.getRepository(EtlStageLog)),
      new RejectedRecordRepository(ds.getRepository(RejectedRecord)),
      new DictionaryRepository(ds.getRepository(VehicleDictionaryView)),
      new MarketplaceVehiclesWriteAdapter(ds),
    );
  });

  afterAll(async () => {
    __setEmbedder(undefined);
    await cleanup(jobs);
    await disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('loads a clean file end to end', async () => {
    const jobId = await upload([HEADER, good(1), good(2), good(3)].join('\n'));

    await orchestrator.run(jobId);

    expect(await jobRow(jobId)).toMatchObject({
      status: 'COMPLETED',
      total_records: 3,
      valid_records: 3,
      invalid_records: 0,
    });
  });

  it('resolves the dictionary against real seed data', async () => {
    // The snapshot is loaded from marketplace.vehicle_dictionaries here, not
    // from a fixture: a seed that stopped matching the generator would show up
    // as unresolved makes rather than as a passing unit test.
    const jobId = await upload(
      [HEADER, `${plate(10)},toyata,vits,2015,Rs. 3500000,45000 km,Petrol,Auto,Saloon`].join('\n'),
    );

    await orchestrator.run(jobId);

    const [stored] = (await ds.query(
      `SELECT make, model, vehicle_type, fuel_type, transmission_type,
              price::float8 AS price, mileage, specs->>'body_type' AS body_type
         FROM marketplace.vehicles WHERE upload_job_id = $1`,
      [jobId],
    )) as Record<string, unknown>[];

    expect(stored).toMatchObject({
      make: 'Toyota',
      model: 'Vitz',
      vehicle_type: 'CAR',
      fuel_type: 'PETROL',
      transmission_type: 'AUTOMATIC',
      price: 3_500_000,
      mileage: 45_000,
      body_type: 'SEDAN',
    });
  });

  it('ends PARTIAL and records why, when some rows are rejected', async () => {
    const jobId = await upload(
      [
        HEADER,
        good(20),
        `${plate(21)},Toyota,Vitz,1850,3500000,45000,Petrol,Automatic,Hatchback`,
        `${plate(22)},Lamborghini,Aventador,2015,3500000,45000,Petrol,Automatic,Coupe`,
      ].join('\n'),
    );

    await orchestrator.run(jobId);

    expect(await jobRow(jobId)).toMatchObject({
      status: 'PARTIAL',
      total_records: 3,
      valid_records: 1,
      invalid_records: 2,
    });

    const rejections = (await ds.query(
      `SELECT row_number, reason FROM ingestion.rejected_records
        WHERE upload_job_id = $1 ORDER BY row_number`,
      [jobId],
    )) as { row_number: number; reason: string }[];

    expect(rejections.map((r) => r.row_number)).toEqual([2, 3]);
    expect(rejections[0].reason).toMatch(/year 1850/);
    expect(rejections[1].reason).toMatch(/make "Lamborghini"/);
  });

  it('ends FAILED when nothing lands', async () => {
    const jobId = await upload(
      [HEADER, `${plate(30)},Toyota,Vitz,2015,-1,45000,Petrol,Automatic,Hatchback`].join('\n'),
    );

    await orchestrator.run(jobId);

    expect(await jobRow(jobId)).toMatchObject({ status: 'FAILED', valid_records: 0 });
  });

  it('fails the whole job on a malformed file, with a readable reason', async () => {
    // validateFile is the only stage allowed to do this: a file with no year
    // column has no rows to reject individually.
    const jobId = await upload('make,model\nToyota,Vitz\n');

    await orchestrator.run(jobId);

    expect(await jobRow(jobId)).toMatchObject({ status: 'FAILED' });

    const [rejection] = (await ds.query(
      `SELECT row_number, reason FROM ingestion.rejected_records WHERE upload_job_id = $1`,
      [jobId],
    )) as { row_number: number; reason: string }[];

    expect(rejection.row_number).toBe(0);
    expect(rejection.reason).toMatch(/Missing required columns: year, price, mileage/);
  });

  it('completes an empty inventory rather than failing it', async () => {
    const jobId = await upload(`${HEADER}\n`);

    await orchestrator.run(jobId);

    expect(await jobRow(jobId)).toMatchObject({
      status: 'COMPLETED',
      valid_records: 0,
      invalid_records: 0,
    });
  });

  it('writes a stage log for every stage', async () => {
    const jobId = await upload([HEADER, good(40)].join('\n'));

    await orchestrator.run(jobId);

    const stages = (await ds.query(
      `SELECT DISTINCT stage FROM ingestion.etl_stage_logs WHERE upload_job_id = $1`,
      [jobId],
    )) as { stage: string }[];

    expect(stages.map((s) => s.stage).sort()).toEqual([
      'EMBED',
      'ENRICH',
      'GROQ_NORMALIZE',
      'LOAD',
      'PARSE_NORMALIZE',
      'SPLIT_CHUNKS',
      'VALIDATE_FILE',
      'VALIDATE_ROWS',
    ]);
  });

  it('logs GROQ_NORMALIZE as SKIPPED without a key', async () => {
    // The keyless path is required behaviour: CI has no key, and an upload
    // cannot fail because a third party is unreachable.
    const previous = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    try {
      const jobId = await upload([HEADER, good(50)].join('\n'));
      await orchestrator.run(jobId);

      const [log] = (await ds.query(
        `SELECT status FROM ingestion.etl_stage_logs
          WHERE upload_job_id = $1 AND stage = 'GROQ_NORMALIZE'`,
        [jobId],
      )) as { status: string }[];

      expect(log.status).toBe('SKIPPED');
    } finally {
      if (previous !== undefined) process.env.GROQ_API_KEY = previous;
    }
  });

  describe('idempotency', () => {
    it('re-running a job inserts nothing new', async () => {
      // The claim §A8 rests on. Rows with a null registration number miss both
      // partial indexes, so the database cannot deduplicate them — only the
      // succeededChunks skip protects them.
      const jobId = await upload([HEADER, good(60), good(61)].join('\n'));

      await orchestrator.run(jobId);
      const first = await jobRow(jobId);

      await orchestrator.run(jobId);
      const second = await jobRow(jobId);

      expect(second).toEqual(first);

      const [{ count }] = (await ds.query(
        `SELECT count(*)::int AS count FROM marketplace.vehicles WHERE upload_job_id = $1`,
        [jobId],
      )) as { count: number }[];

      expect(count).toBe(2);
    });

    it('does not duplicate rows with no registration number', async () => {
      // These miss idx_vehicles_registration_number AND
      // idx_vehicles_job_registration, so a re-run has nothing to conflict on.
      const jobId = await upload(
        [
          HEADER,
          ',Toyota,Vitz,2015,3500000,45000,Petrol,Automatic,Hatchback',
          ',Toyota,Vitz,2016,3600000,40000,Petrol,Automatic,Hatchback',
        ].join('\n'),
      );

      await orchestrator.run(jobId);
      await orchestrator.run(jobId);

      const [{ count }] = (await ds.query(
        `SELECT count(*)::int AS count FROM marketplace.vehicles WHERE upload_job_id = $1`,
        [jobId],
      )) as { count: number }[];

      expect(count).toBe(2);
    });

    it('does not downgrade a completed job on re-run', async () => {
      const jobId = await upload([HEADER, good(70)].join('\n'));

      await orchestrator.run(jobId);
      await orchestrator.run(jobId);

      expect(await jobRow(jobId)).toMatchObject({ status: 'COMPLETED', valid_records: 1 });
    });
  });

  it('rejects a duplicate registration already listed under another job', async () => {
    const duplicate = plate(80);
    const firstJob = await upload(
      [HEADER, `${duplicate},Toyota,Vitz,2015,3500000,45000,Petrol,Automatic,Hatchback`].join('\n'),
    );
    await orchestrator.run(firstJob);

    const secondJob = await upload(
      [HEADER, `${duplicate},Toyota,Vitz,2015,3500000,45000,Petrol,Automatic,Hatchback`].join('\n'),
    );
    await orchestrator.run(secondJob);

    expect(await jobRow(secondJob)).toMatchObject({ status: 'FAILED', valid_records: 0 });

    const [rejection] = (await ds.query(
      `SELECT reason FROM ingestion.rejected_records WHERE upload_job_id = $1`,
      [secondJob],
    )) as { reason: string }[];

    expect(rejection.reason).toMatch(/already listed/);
  });

  it('rejects an intra-job duplicate before it can overwrite', async () => {
    // Both rows would upsert over each other under the composite index; the
    // second silently overwriting the first, with no error anywhere.
    const duplicate = plate(90);
    const jobId = await upload(
      [
        HEADER,
        `${duplicate},Toyota,Vitz,2015,3500000,45000,Petrol,Automatic,Hatchback`,
        `${duplicate},Toyota,Vitz,2016,3600000,40000,Petrol,Automatic,Hatchback`,
      ].join('\n'),
    );

    await orchestrator.run(jobId);

    expect(await jobRow(jobId)).toMatchObject({
      status: 'PARTIAL',
      valid_records: 1,
      invalid_records: 1,
    });

    const [rejection] = (await ds.query(
      `SELECT row_number, reason FROM ingestion.rejected_records WHERE upload_job_id = $1`,
      [jobId],
    )) as { row_number: number; reason: string }[];

    expect(rejection.row_number).toBe(2);
    expect(rejection.reason).toMatch(/duplicate registration_number/);
  });
});
