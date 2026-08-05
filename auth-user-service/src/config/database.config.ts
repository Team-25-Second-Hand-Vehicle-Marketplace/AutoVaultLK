import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * auth-user-service owns the `auth` schema: users, dealer_profiles,
 * refresh_tokens. Its role has no privileges on any other schema.
 */
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.AUTH_DATABASE_URL,
  schema: 'auth',
  entities: [__dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}'],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  extra: { max: 5 },
});
