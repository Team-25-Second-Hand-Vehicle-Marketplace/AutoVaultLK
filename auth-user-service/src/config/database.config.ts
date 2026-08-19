import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * auth-user-service owns the `auth` schema: users, dealer_profiles,
 * refresh_tokens. Its role has no privileges on any other schema.
 */
export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.AUTH_DATABASE_URL,
  schema: 'auth',
  entities: [
    __dirname + '/../infrastructure/database/entities/*.entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.view-entity{.ts,.js}',
    __dirname + '/../infrastructure/database/entities/*.write-entity{.ts,.js}',
  ],
  // Never true. Five services share one database; a single sync would
  // reshape tables out from under the others. Migrations own all DDL.
  synchronize: false,
  // RDS enforces TLS via the rds.force_ssl parameter, so connections without
  // SSL are refused outright. Local Docker Postgres serves no certificate, so
  // this has to stay opt-in rather than always-on — set DATABASE_SSL=true in
  // the Lambda environment, leave it unset locally.
  //
  // rejectUnauthorized: false encrypts the connection but does not verify the
  // server certificate against a CA. That accepts a theoretical MITM inside
  // AWS's network in exchange for not shipping the RDS CA bundle into the
  // image. Revisit if this ever handles production data.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  extra: { max: 5 },
});
