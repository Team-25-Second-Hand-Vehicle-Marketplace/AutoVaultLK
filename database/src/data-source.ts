import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// Load the root .env so DATABASE_URL is picked up without exporting it
// manually. This package uses the migration-runner role (superuser, DDL
// rights) — never one of the scoped per-service roles.
config({ path: '../.env' });

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  migrationsTableName: 'typeorm_migrations',
  migrations: ['src/migrations/*.{ts,js}'],
  entities: [],
  synchronize: false,
  // RDS refuses non-SSL connections (rds.force_ssl=1); local Docker Postgres
  // serves no certificate. Opt in with DATABASE_SSL=true when pointing this
  // at RDS to run migrations, and leave it unset for local work.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
