import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: '../.env' });

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  migrationsTableName: 'typeorm_migrations',
  migrations: ['src/migrations/*.{ts,js}'],
  entities: [],
  synchronize: false,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
