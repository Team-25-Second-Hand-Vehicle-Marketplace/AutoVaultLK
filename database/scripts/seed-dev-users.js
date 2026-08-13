/**
 * Local demo accounts so the frontend dashboards can be signed into.
 * Password for every account: Password1
 *
 * Usage (from database/): npm run seed:dev
 */
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PASSWORD = 'Password1';

const ACCOUNTS = [
  {
    email: 'admin@autovault.lk',
    name: 'Nimal Perera',
    role: 'ADMIN',
  },
  {
    email: 'buyer@autovault.lk',
    name: 'Amaya Fernando',
    role: 'BUYER',
  },
  {
    email: 'dealer@autovault.lk',
    name: 'Kasun Jayawardena',
    role: 'DEALER',
  },
];

function loadBcrypt() {
  try {
    return require('bcryptjs');
  } catch {
    return require(path.resolve(
      __dirname,
      '../../auth-user-service/node_modules/bcryptjs',
    ));
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is missing. Copy .env.example to the repo root .env');
  }

  const bcrypt = loadBcrypt();
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query('BEGIN');

    for (const account of ACCOUNTS) {
      await client.query(
        `
        INSERT INTO auth.users (
          email, password_hash, name, role, is_active,
          email_verified_at, failed_login_attempts, locked_until
        )
        VALUES ($1, $2, $3, $4, true, now(), 0, NULL)
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          is_active = true,
          email_verified_at = now(),
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = now()
        `,
        [account.email, passwordHash, account.name, account.role],
      );
    }

    const admin = await client.query(
      `SELECT id FROM auth.users WHERE email = $1`,
      ['admin@autovault.lk'],
    );
    const dealer = await client.query(
      `SELECT id FROM auth.users WHERE email = $1`,
      ['dealer@autovault.lk'],
    );

    await client.query(
      `
      INSERT INTO auth.dealer_profiles (
        user_id, company_name, contact_number, dealer_type,
        business_registration_number, business_address, city,
        verification_documents, verification_status, verified_by, verified_at
      )
      VALUES (
        $1,
        'Jayawardena Motors',
        '+94771234567',
        'business',
        'PV123456',
        '42 Galle Road, Colombo 03',
        'Colombo',
        $2::jsonb,
        'VERIFIED',
        $3,
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        contact_number = EXCLUDED.contact_number,
        dealer_type = EXCLUDED.dealer_type,
        business_registration_number = EXCLUDED.business_registration_number,
        business_address = EXCLUDED.business_address,
        city = EXCLUDED.city,
        verification_documents = EXCLUDED.verification_documents,
        verification_status = 'VERIFIED',
        verified_by = EXCLUDED.verified_by,
        verified_at = now(),
        updated_at = now()
      `,
      [
        dealer.rows[0].id,
        JSON.stringify({ note: 'Local demo dealer — pre-approved' }),
        admin.rows[0].id,
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  console.log('Seeded local demo accounts (password: Password1)');
  console.log('  admin@autovault.lk   → /auth/login/admin → /admin');
  console.log('  buyer@autovault.lk   → /auth/login → /buyer');
  console.log('  dealer@autovault.lk  → /auth/login?role=dealer → /dealer');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
