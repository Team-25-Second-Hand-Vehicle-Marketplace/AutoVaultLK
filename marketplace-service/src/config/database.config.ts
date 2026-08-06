import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * marketplace-service owns the `marketplace` schema: vehicles,
 * vehicle_images, favourites, search_queries, vehicle_dictionaries.
 *
 * It additionally holds SELECT on auth.users, auth.dealer_profiles and
 * ingestion.upload_jobs — read-only, for joins and the review dashboard.
 * Those tables are declared as view-entities here, never migrated by
 * this service. See database/src/grants.sql for the exact grants.
 */
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.MARKETPLACE_DATABASE_URL,
  schema: 'marketplace',
  entities: [__dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}'],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  // Small pool per Lambda container; RDS Proxy multiplexes in production.
  extra: { max: 5 },
});
