import 'reflect-metadata';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  migrationsTableName: 'typeorm_migrations',
  migrations: ['src/migrations/*.{ts,js}'],
  entities: [],
  synchronize: false,
});
