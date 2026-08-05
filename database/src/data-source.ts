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
});
