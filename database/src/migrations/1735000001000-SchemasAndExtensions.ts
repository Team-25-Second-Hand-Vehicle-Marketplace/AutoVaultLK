import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotent safety net. Docker init scripts already do this on a fresh
 * volume, but they only fire when the data directory is empty. Anyone
 * running migrations against an existing database needs these present.
 */
export class SchemasAndExtensions1735000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS marketplace`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS ingestion`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS notification`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS admin`);
  }

  public async down(): Promise<void> {
    // Schemas are not dropped — that would cascade away every table.
  }
}
