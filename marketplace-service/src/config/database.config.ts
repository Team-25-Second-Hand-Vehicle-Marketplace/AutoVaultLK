import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.MARKETPLACE_DATABASE_URL,
  schema: 'marketplace',
  entities: [
    __dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.view-entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.write-entity{.ts,.js}',
  ],

  synchronize: false,

  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,

  extra: { max: 5 },
});
