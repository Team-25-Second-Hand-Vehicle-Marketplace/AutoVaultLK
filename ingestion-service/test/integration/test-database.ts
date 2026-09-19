import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { EtlStageLog } from '../../src/infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../../src/infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../../src/infrastructure/database/entities/upload-job.entity';
import { VehicleDictionaryView } from '../../src/infrastructure/database/entities/vehicle-dictionary.view-entity';

loadEnv({ path: '../.env' });
loadEnv({ path: '.env' });

/**
 * Shared setup for the integration suite.
 *
 * These tests exist because every persistence unit test asserts on the SQL
 * *string*. A conflict target whose WHERE clause does not match its partial
 * index, or a cast pgvector rejects, passes every one of those and fails on the
 * first real upload. Only a live Postgres can tell the difference.
 *
 * Requires a migrated, seeded database — the one docker-compose brings up:
 *
 *   docker compose up -d postgres
 *   npm --prefix database run migration:run
 *   npm --prefix database run grants
 *   npm --prefix database run seed:dictionaries
 *
 * When no database is reachable the suite SKIPS rather than fails. A developer
 * without Docker running should not see a red build for a suite they were never
 * asked to run; CI opts in explicitly with a postgres service container.
 */

export const INTEGRATION_DATABASE_URL =
  process.env.INGESTION_DATABASE_URL ??
  'postgresql://ingestion_service_role:dev_ingestion@localhost:5433/vehicle_marketplace';

let cached: DataSource | undefined;

export async function connect(): Promise<DataSource | null> {
  if (cached?.isInitialized) return cached;

  const dataSource = new DataSource({
    type: 'postgres',
    url: INTEGRATION_DATABASE_URL,
    // The real entities, so repositories under test map columns exactly as
    // they do in the running service. `schema` matches database.config.ts —
    // without it the ingestion tables resolve to `public`.
    schema: 'ingestion',
    entities: [UploadJob, RejectedRecord, EtlStageLog, VehicleDictionaryView],
    synchronize: false,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    // These tests run serially (maxWorkers: 1) and the role's pool is sized for
    // the ETL, not for a test runner holding connections open.
    extra: { max: 2 },
  });

  try {
    await dataSource.initialize();
    cached = dataSource;
    return dataSource;
  } catch {
    return null;
  }
}

export async function disconnect(): Promise<void> {
  if (cached?.isInitialized) await cached.destroy();
  cached = undefined;
}

/**
 * `describe` that skips when the database is unreachable, printing why once.
 *
 * Jest needs the skip decision before any `beforeAll` runs, so this probes with
 * a synchronous child process rather than an async connect — a promise cannot
 * be awaited at describe-registration time.
 */
export function describeWithDatabase(name: string, body: () => void): void {
  if (databaseIsReachable()) {
    describe(name, body);
    return;
  }

  describe.skip(`${name} [skipped: no database at ${redact(INTEGRATION_DATABASE_URL)}]`, body);
}

let reachable: boolean | undefined;

function databaseIsReachable(): boolean {
  if (reachable !== undefined) return reachable;

  // A TCP probe, not a query: enough to tell "nothing is listening" from "the
  // database is there", which is the only distinction the skip needs.
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const url = new URL(INTEGRATION_DATABASE_URL);
  const port = url.port || '5432';

  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        `const net=require('net');const s=net.connect(${port},${JSON.stringify(url.hostname)});` +
          `s.setTimeout(1500);s.on('connect',()=>{s.destroy();process.exit(0)});` +
          `s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));`,
      ],
      { stdio: 'ignore' },
    );
    reachable = true;
  } catch {
    reachable = false;
  }

  return reachable;
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, '//***@');
}

/** A dealer to own the test jobs. Any will do — dealer_id comes from the job. */
export async function findDealer(ds: DataSource): Promise<string> {
  const [dealer] = (await ds.query(
    `SELECT id FROM auth.users WHERE role = 'DEALER' LIMIT 1`,
  )) as { id: string }[];

  if (!dealer) {
    throw new Error('No DEALER user in the database. Run the auth seed first.');
  }

  return dealer.id;
}

export async function createJob(ds: DataSource, dealerId: string): Promise<string> {
  const [job] = (await ds.query(
    `INSERT INTO ingestion.upload_jobs (dealer_id, file_name, csv_s3_path, status)
     VALUES ($1, 'integration.csv', 'raw/integration.csv', 'PENDING')
     RETURNING id`,
    [dealerId],
  )) as { id: string }[];

  return job.id;
}

/**
 * Removes everything a test created.
 *
 * ingestion_service_role holds no DELETE on marketplace.vehicles (ADR-002) —
 * the same grant the adapter is built around — so cleanup connects as the
 * owner. That asymmetry is the point: if this ever succeeds as the ETL role,
 * the grant has been widened and the architectural claim is gone.
 */
export async function cleanup(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;

  const owner = new DataSource({
    type: 'postgres',
    url:
      process.env.DATABASE_URL ??
      'postgresql://marketplace:marketplace@localhost:5433/vehicle_marketplace',
    entities: [],
    synchronize: false,
    extra: { max: 1 },
  });

  await owner.initialize();
  try {
    await owner.query(`DELETE FROM marketplace.vehicles WHERE upload_job_id = ANY($1)`, [jobIds]);
    await owner.query(`DELETE FROM ingestion.rejected_records WHERE upload_job_id = ANY($1)`, [
      jobIds,
    ]);
    await owner.query(`DELETE FROM ingestion.etl_stage_logs WHERE upload_job_id = ANY($1)`, [
      jobIds,
    ]);
    await owner.query(`DELETE FROM ingestion.upload_jobs WHERE id = ANY($1)`, [jobIds]);
  } finally {
    await owner.destroy();
  }
}
