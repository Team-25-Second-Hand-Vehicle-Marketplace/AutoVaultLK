import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * admin-service owns the `admin` schema: audit_logs.
 *
 * It is the one read-heavy service: SELECT on every other schema for the
 * dashboard and reports (see database/src/grants.sql). It can never
 * INSERT or DELETE another service's rows — every admin mutation goes
 * through the owning service's API.
 */
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.ADMIN_DATABASE_URL,
  schema: 'admin',
  entities: [
    __dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.view-entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.write-entity{.ts,.js}',
  ],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  // Opt-in TLS: RDS refuses non-SSL connections (rds.force_ssl), local Docker
  // Postgres serves no certificate. Set DATABASE_SSL=true in AWS only.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  extra: { max: 5 },
});
