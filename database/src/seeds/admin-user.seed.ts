import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

config({ path: '../.env' });


const DEFAULT_EMAIL = 'admin@autovault.lk';
const DEFAULT_NAME = 'System Administrator';

function assertPasswordMeetsPolicy(password: string): void {
  const failures: string[] = [];

  if (password.length < 8) failures.push('at least 8 characters');
  if (!/[a-z]/.test(password)) failures.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('an uppercase letter');
  if (!/[0-9]/.test(password)) failures.push('a number');

  if (failures.length > 0) {
    throw new Error(
      `ADMIN_SEED_PASSWORD does not meet the password policy — needs ${failures.join(', ')}.`,
    );
  }
}

async function seed() {
  const email = process.env.ADMIN_SEED_EMAIL ?? DEFAULT_EMAIL;
  const name = process.env.ADMIN_SEED_NAME ?? DEFAULT_NAME;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!password) {
    throw new Error(
      'ADMIN_SEED_PASSWORD is not set. Refusing to seed an administrator with a ' +
        'default password. Set it in .env (local) or the environment (deployed).',
    );
  }

  assertPasswordMeetsPolicy(password);

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [],
    synchronize: false,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await ds.initialize();
  console.log(`Connected. Seeding administrator ${email}…`);

  const passwordHash = await bcrypt.hash(password, 12);

  await ds.query(
    `INSERT INTO auth.users (email, password_hash, name, role, is_active)
     VALUES ($1, $2, $3, 'ADMIN', true)
     ON CONFLICT (email) DO NOTHING`,
    [email, passwordHash, name],
  );

  const [row] = await ds.query(
    `SELECT id, role, created_at FROM auth.users WHERE email = $1`,
    [email],
  );

  if (!row) {
    throw new Error(`Insert reported success but ${email} is not present.`);
  }

  if (row.role !== 'ADMIN') {

    throw new Error(
      `${email} already exists with role ${row.role}, not ADMIN. Refusing to ` +
        'change the role of an existing account — use a different ' +
        'ADMIN_SEED_EMAIL, or promote this user deliberately.',
    );
  }

  const wasExisting = Date.now() - new Date(row.created_at).getTime() > 5000;

  if (wasExisting) {
    console.log(
      `Administrator ${email} already existed (id ${row.id}). Password NOT ` +
        'changed — re-running this seed does not rotate credentials. Use the ' +
        'password reset flow to change it.',
    );
  } else {
    console.log(`Seeded administrator ${email} (id ${row.id}).`);
  }

  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
