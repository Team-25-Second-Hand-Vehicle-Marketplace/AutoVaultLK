const { config } = require('dotenv');
const { Client } = require('pg');
const path = require('path');

config({ path: path.resolve(__dirname, '../../.env') });

const ROLES = {
  auth: {
    url: process.env.AUTH_DATABASE_URL,
    label: 'auth_service_role',
    checks: [
      { name: 'SELECT auth.users', sql: 'SELECT 1 FROM auth.users LIMIT 1' },
      {
        name: 'INSERT auth.users (rollback)',
        sql: `INSERT INTO auth.users (email, password_hash, name, role)
              VALUES ('verify-smoke@test.local', 'hash', 'Smoke', 'BUYER')`,
        rollback: true,
      },
      {
        name: 'DENY marketplace write',
        sql: `INSERT INTO marketplace.vehicles (
                dealer_id, make, model, manufacture_year, price, mileage
              ) VALUES (
                gen_random_uuid(), 'X', 'Y', 2020, 1, 0
              )`,
        expectError: true,
      },
    ],
  },
  marketplace: {
    url: process.env.MARKETPLACE_DATABASE_URL,
    label: 'marketplace_service_role',
    checks: [
      {
        name: 'SELECT marketplace.vehicles',
        sql: 'SELECT 1 FROM marketplace.vehicles LIMIT 1',
      },
      {
        name: 'SELECT auth.users (cross-schema read)',
        sql: 'SELECT 1 FROM auth.users LIMIT 1',
      },
      {
        name: 'SELECT auth.dealer_profiles (cross-schema read)',
        sql: 'SELECT 1 FROM auth.dealer_profiles LIMIT 1',
      },
      {
        name: 'DENY auth write',
        sql: `UPDATE auth.users SET name = 'hack' WHERE false`,
        expectError: true,
      },
    ],
  },
  ingestion: {
    url: process.env.INGESTION_DATABASE_URL,
    label: 'ingestion_service_role',
    checks: [
      {
        name: 'SELECT ingestion.upload_jobs',
        sql: 'SELECT 1 FROM ingestion.upload_jobs LIMIT 1',
      },
      {
        name: 'SELECT marketplace.vehicle_dictionaries',
        sql: 'SELECT 1 FROM marketplace.vehicle_dictionaries LIMIT 1',
      },
      {
        name: 'SELECT marketplace.vehicles (ETL read)',
        sql: 'SELECT 1 FROM marketplace.vehicles LIMIT 1',
      },
      {
        name: 'DENY marketplace DELETE',
        sql: 'DELETE FROM marketplace.vehicles WHERE false',
        expectError: true,
      },
    ],
  },
  notification: {
    url: process.env.NOTIFICATION_DATABASE_URL,
    label: 'notification_service_role',
    checks: [
      {
        name: 'SELECT notification.notifications',
        sql: 'SELECT 1 FROM notification.notifications LIMIT 1',
      },
      {
        name: 'SELECT auth.users (cross-schema read)',
        sql: 'SELECT 1 FROM auth.users LIMIT 1',
      },
    ],
  },
  admin: {
    url: process.env.ADMIN_DATABASE_URL,
    label: 'admin_service_role',
    checks: [
      {
        name: 'SELECT admin.audit_logs',
        sql: 'SELECT 1 FROM admin.audit_logs LIMIT 1',
      },
      {
        name: 'SELECT marketplace.vehicles (read-only)',
        sql: 'SELECT 1 FROM marketplace.vehicles LIMIT 1',
      },
      {
        name: 'DENY marketplace write',
        sql: `INSERT INTO marketplace.vehicles (
                dealer_id, make, model, manufacture_year, price, mileage
              ) VALUES (
                gen_random_uuid(), 'X', 'Y', 2020, 1, 0
              )`,
        expectError: true,
      },
    ],
  },
};

const SCHEMA_CHECKS = [
  {
    name: 'migration 1800 — verified_by on dealer_profiles',
    sql: `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'auth' AND table_name = 'dealer_profiles'
            AND column_name = 'verified_by'`,
    expectRows: 1,
  },
  {
    name: 'migration 1900 — idx_vehicles_job_registration',
    sql: `SELECT 1 FROM pg_indexes
          WHERE schemaname = 'marketplace' AND indexname = 'idx_vehicles_job_registration'`,
    expectRows: 1,
  },
];

function isPermissionError(err) {
  return err.code === '42501' || /permission denied/i.test(err.message);
}

async function runCheck(client, check) {
  if (check.expectError) {
    try {
      await client.query('BEGIN');
      await client.query(check.sql);
      await client.query('ROLLBACK');
      return { ok: false, detail: 'expected permission error but query succeeded' };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (isPermissionError(err)) {
        return { ok: true };
      }
      return { ok: false, detail: err.message };
    }
  }

  try {
    if (check.rollback) {
      await client.query('BEGIN');
      await client.query(check.sql);
      await client.query('ROLLBACK');
    } else {
      await client.query(check.sql);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function verifyRole(key, role) {
  if (!role.url) {
    return [{ name: `${role.label} URL`, ok: false, detail: 'missing env var' }];
  }

  const client = new Client({ connectionString: role.url });
  const results = [];

  try {
    await client.connect();
    results.push({ name: 'connect', ok: true });

    for (const check of role.checks) {
      const result = await runCheck(client, check);
      results.push({ name: check.name, ...result });
    }
  } catch (err) {
    results.push({ name: 'connect', ok: false, detail: err.message });
  } finally {
    await client.end().catch(() => {});
  }

  return results.map((r) => ({ role: key, ...r }));
}

async function verifySchema(url) {
  const client = new Client({ connectionString: url });
  const results = [];

  try {
    await client.connect();
    for (const check of SCHEMA_CHECKS) {
      const { rows } = await client.query(check.sql);
      const ok = rows.length >= (check.expectRows ?? 1);
      results.push({
        role: 'schema',
        name: check.name,
        ok,
        detail: ok ? undefined : `expected rows, got ${rows.length}`,
      });
    }
  } catch (err) {
    results.push({
      role: 'schema',
      name: 'schema checks',
      ok: false,
      detail: err.message,
    });
  } finally {
    await client.end().catch(() => {});
  }

  return results;
}

async function main() {
  const migrationUrl = process.env.DATABASE_URL;
  if (!migrationUrl) {
    console.error('DATABASE_URL is not set (repo root .env)');
    process.exit(1);
  }

  console.log('Database role verification (Plan B smoke test)\n');

  const allResults = [
    ...(await verifySchema(migrationUrl)),
    ...(await Promise.all(
      Object.entries(ROLES).map(([key, role]) => verifyRole(key, role)),
    )).flat(),
  ];

  let failed = 0;
  for (const r of allResults) {
    const status = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) failed += 1;
    const detail = r.detail ? ` — ${r.detail}` : '';
    console.log(`[${status}] ${r.role}: ${r.name}${detail}`);
  }

  console.log(`\n${allResults.length - failed}/${allResults.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
