import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

loadEnv({ path: '../.env' });
loadEnv({ path: '.env' });

/**
 * Shared setup for the marketplace integration suite.
 *
 * These tests exist because the search unit tests assert on the SQL *string*.
 * That catches a typo in a column name and nothing else: a `::vector` cast
 * pgvector rejects, a `word_similarity` call with its arguments the wrong way
 * round, a cross-schema join to a table whose owning service renamed a column
 * — every one of those passes the unit suite and fails on the first real
 * search. Only a live Postgres can tell the difference.
 *
 * Requires a migrated, seeded database — the one docker-compose brings up:
 *
 *   docker compose up -d postgres
 *   npm --prefix database run migration:run
 *   npm --prefix database run grants
 *   npm --prefix database run seed:vehicles
 *   npm --prefix database run seed:embeddings
 *
 * When no database is reachable the suite SKIPS rather than fails, matching
 * ingestion-service/test/integration/test-database.ts. A developer without
 * Docker running should not see a red build for a suite they were never asked
 * to run; CI opts in explicitly with a postgres service container.
 */

export const INTEGRATION_DATABASE_URL =
  process.env.MARKETPLACE_DATABASE_URL ??
  'postgresql://marketplace_service_role:dev_marketplace@localhost:5433/vehicle_marketplace';

let cached: DataSource | undefined;

/**
 * Connects as `marketplace_service_role`, not as the database owner.
 *
 * That is deliberate: the cross-schema reads these tests cover (auth.users,
 * auth.dealer_profiles) depend on grants that live in database/src/grants.sql.
 * Running as the owner would pass whether or not those grants exist, and the
 * first deploy would then be where the missing GRANT is discovered.
 */
export async function connect(): Promise<DataSource | null> {
  if (cached?.isInitialized) return cached;

  const dataSource = new DataSource({
    type: 'postgres',
    url: INTEGRATION_DATABASE_URL,
    // Matches src/config/database.config.ts. Without it the unqualified
    // relations in these queries would resolve against `public`.
    schema: 'marketplace',
    entities: [],
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
 * A deterministic unit vector of the right dimensionality.
 *
 * The tests below assert on *ordering*, not on semantic relevance, so a
 * synthetic vector is both sufficient and preferable: loading the real MiniLM
 * model would make the suite slow and its results depend on a model download.
 * `seed` varies the direction so two different vectors rank rows differently.
 */
export function fakeEmbedding(seed = 1): number[] {
  const values = Array.from({ length: 384 }, (_, i) =>
    Math.sin((i + 1) * seed),
  );
  const norm = Math.sqrt(values.reduce((sum, n) => sum + n * n, 0));
  return values.map((n) => n / norm);
}

/**
 * A typed `ds.query`.
 *
 * TypeORM declares `query()` as returning `any`, so an inline
 * `(await ds.query(...)) as Row[]` is an assertion eslint flags as redundant
 * while still leaving the call site untyped. Naming the row shape here gives
 * the tests real types without the assertion.
 */
export async function queryRows<T>(
  ds: DataSource,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  // `query()` is declared as returning `any`, so the annotation above is what
  // gives the call sites their types; no assertion is needed here.
  return ds.query(sql, params);
}

/** The first row, for the many queries here that select exactly one. */
export async function queryRow<T>(
  ds: DataSource,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const [first] = await queryRows<T>(ds, sql, params);
  return first;
}

/** The embedding of an existing row, so a query can rank against real data. */
export async function embeddingOfSomeVehicle(
  ds: DataSource,
): Promise<{ id: string; embedding: number[] } | null> {
  const found = await queryRows<{ id: string; embedding: string }>(
    ds,
    `SELECT id, embedding::text AS embedding
       FROM marketplace.vehicles
      WHERE embedding IS NOT NULL AND status = 'LIVE'
      LIMIT 1`,
  );

  if (found.length === 0) return null;

  return {
    id: found[0].id,
    embedding: JSON.parse(found[0].embedding) as number[],
  };
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
