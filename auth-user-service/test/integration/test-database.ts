import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { DataSource, Repository } from 'typeorm';
import { DealerProfile } from '../../src/infrastructure/database/entities/dealer-profile.entity';
import { EmailVerificationToken } from '../../src/infrastructure/database/entities/email-verification-token.entity';
import { PasswordHistory } from '../../src/infrastructure/database/entities/password-history.entity';
import { PasswordResetToken } from '../../src/infrastructure/database/entities/password-reset-token.entity';
import { RefreshToken } from '../../src/infrastructure/database/entities/refresh-token.entity';
import { SecurityEvent } from '../../src/infrastructure/database/entities/security-event.entity';
import { User } from '../../src/infrastructure/database/entities/user.entity';

loadEnv({ path: '../.env' });
loadEnv({ path: '.env' });

/**
 * Shared setup for the auth-user-service integration suite.
 *
 * auth-user-service owns its schema outright - no cross-schema reads - so
 * unlike marketplace/admin/notification the risk here is not a missing
 * GRANT. It is the real constraints and cascade actions a stubbed
 * Repository<T> unit test cannot see: users.email and *_tokens.token_hash
 * both carry a unique index (so a race that produces two tokens for the
 * same secret fails loudly instead of silently colliding), and
 * refresh_tokens/dealer_profiles/password_history all CASCADE on user
 * deletion while refresh_tokens.replaced_by_id and security_events.user_id
 * SET NULL instead - the difference between "this history disappears" and
 * "this history survives, orphaned" is a migration detail no unit test
 * exercises.
 *
 * Requires a migrated, seeded database - the one docker-compose brings up:
 *
 *   docker compose up -d postgres
 *   npm --prefix database run migration:run
 *   npm --prefix database run grants
 *
 * When no database is reachable the suite SKIPS rather than fails, matching
 * marketplace-service/test/integration/test-database.ts.
 */

export const INTEGRATION_DATABASE_URL =
  process.env.AUTH_DATABASE_URL ??
  'postgresql://auth_service_role:dev_auth@localhost:5433/vehicle_marketplace';

let cached: DataSource | undefined;

/**
 * Connects as `auth_service_role`, not as the database owner, for
 * consistency with the rest of the integration suites even though this
 * service's own reads never leave its own schema.
 */
export async function connect(): Promise<DataSource | null> {
  if (cached?.isInitialized) return cached;

  const dataSource = new DataSource({
    type: 'postgres',
    url: INTEGRATION_DATABASE_URL,
    // Matches src/config/database.config.ts. Without it the unqualified
    // relations in these repositories would resolve against `public`.
    schema: 'auth',
    entities: [
      User,
      RefreshToken,
      DealerProfile,
      PasswordHistory,
      EmailVerificationToken,
      PasswordResetToken,
      SecurityEvent,
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
 * a synchronous child process rather than an async connect - a promise cannot
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

let counter = 0;

/** A unique-enough email for a fixture user, without a full UUID for readability in failures. */
export function fixtureEmail(label = 'integration'): string {
  counter += 1;
  return `${label}-${Date.now()}-${counter}@example.test`;
}

/**
 * Creates and persists a throwaway user for a test to hang fixtures off,
 * with its id tracked by the caller for cleanup. Deleting the user cascades
 * to every row created against it in refresh_tokens, dealer_profiles and
 * password_history, and SETs NULL on security_events.user_id - exactly the
 * behaviour these suites exist to prove, so cleanup itself becomes part of
 * the coverage rather than working around it.
 */
export async function createFixtureUser(
  ds: DataSource,
  overrides: Partial<User> = {},
): Promise<User> {
  const users = ds.getRepository(User);
  return users.save(
    users.create({
      email: fixtureEmail(),
      passwordHash: 'not-a-real-hash',
      name: 'Integration Test User',
      role: 'BUYER',
      ...overrides,
    }),
  );
}

export async function deleteFixtureUser(ds: DataSource, userId: string): Promise<void> {
  await ds.getRepository(User).delete(userId);
}
