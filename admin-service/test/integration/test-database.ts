import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../../src/infrastructure/database/entities/audit-log.entity';
import { AuthUserView } from '../../src/infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../src/infrastructure/database/entities/dealer-profile.view-entity';
import { NotificationView } from '../../src/infrastructure/database/entities/notification.view-entity';
import { RejectedRecordView } from '../../src/infrastructure/database/entities/rejected-record.view-entity';
import { UploadJobView } from '../../src/infrastructure/database/entities/upload-job.view-entity';
import { VehicleView } from '../../src/infrastructure/database/entities/vehicle.view-entity';

loadEnv({ path: '../.env' });
loadEnv({ path: '.env' });

/**
 * Shared setup for the admin-service integration suite.
 *
 * admin_service_role holds SELECT across auth, marketplace, ingestion and
 * notification — read-only everywhere but its own `admin` schema (see
 * database.config.ts). None of that is visible to a unit test: a unit test
 * against AdminReadsRepository stubs every Repository<T>, so it can never
 * catch a missing cross-schema GRANT, a view entity's column no longer
 * matching the owning service's real column, or a raw query-builder clause
 * (DATE_TRUNC, the audit_logs filter chain) that only a live Postgres can
 * validate.
 *
 * Requires a migrated, seeded database — the one docker-compose brings up:
 *
 *   docker compose up -d postgres
 *   npm --prefix database run migration:run
 *   npm --prefix database run grants
 *   npm --prefix database run seed:vehicles
 *
 * When no database is reachable the suite SKIPS rather than fails, matching
 * marketplace-service/test/integration/test-database.ts.
 */

export const INTEGRATION_DATABASE_URL =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://admin_service_role:dev_admin@localhost:5433/vehicle_marketplace';

let cached: DataSource | undefined;

/**
 * Connects as `admin_service_role`, not as the database owner.
 *
 * That is deliberate: every cross-schema read here (auth.users,
 * auth.dealer_profiles, marketplace.vehicles, ingestion.upload_jobs,
 * ingestion.rejected_records, notification.notifications) depends on a
 * SELECT grant owned by another service's migration. Running as the owner
 * would pass whether or not those grants exist.
 */
export async function connect(): Promise<DataSource | null> {
  if (cached?.isInitialized) return cached;

  const dataSource = new DataSource({
    type: 'postgres',
    url: INTEGRATION_DATABASE_URL,
    // Matches src/config/database.config.ts. Without it the unqualified
    // relations in AuditLogsRepository would resolve against `public`.
    schema: 'admin',
    entities: [
      AuditLog,
      AuthUserView,
      DealerProfileView,
      VehicleView,
      UploadJobView,
      NotificationView,
      RejectedRecordView,
    ],
    synchronize: false,
    ssl:
      process.env.DATABASE_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    // These run serially (maxWorkers: 1); the role's pool is sized for the
    // service, not for a test runner holding connections open.
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

/** A typed Repository<T> off the shared DataSource, for constructing a repository class under test. */
export function repositoryFor<T extends object>(
  ds: DataSource,
  entity: new () => T,
): Repository<T> {
  return ds.getRepository(entity);
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

  describe.skip(
    `${name} [skipped: no database at ${redact(INTEGRATION_DATABASE_URL)}]`,
    body,
  );
}

let reachable: boolean | undefined;

function databaseIsReachable(): boolean {
  if (reachable !== undefined) return reachable;

  // A TCP probe, not a query: enough to tell "nothing is listening" from "the
  // database is there", which is the only distinction the skip needs.
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

/**
 * Skips an individual test when the seeded data it needs is absent.
 *
 * A database that is migrated but not seeded should not produce failures that
 * look like defects in the query under test.
 */
export function itWithData(
  name: string,
  hasData: () => boolean,
  body: () => Promise<void>,
): void {
  it(name, async () => {
    if (!hasData()) {
      console.warn(`[skipped: seeded data missing] ${name}`);
      return;
    }
    await body();
  });
}
