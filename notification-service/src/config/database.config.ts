import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * notification-service owns the `notification` schema: notifications.
 * It holds SELECT on auth.users to resolve recipient email addresses
 * (see database/src/grants.sql).
 */
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.NOTIFICATION_DATABASE_URL,
  schema: 'notification',
  entities: [__dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}'],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  extra: { max: 5 },
});
