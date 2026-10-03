import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 90-day listing expiry, one active listing per registration, and permanent
 * delete with a short-lived snapshot.
 *
 * - A listing's expires_at is published_at + 90 days. The scheduled expiry job
 *   archives LIVE listings past their expires_at.
 * - The registration uniqueness rule moves from "any row, any status" to "one
 *   active row" (DRAFT, PENDING_REVIEW, LIVE). ARCHIVED and REJECTED rows no
 *   longer block the same car from being listed again.
 * - SOLD is removed: a sold car is archived.
 * - deleted_listing_snapshots keeps a full copy of a deleted listing for 30 days
 *   (dispute review). listing_audit_log keeps the permanent record of who
 *   deleted what, and when. Both live in marketplace so marketplace_service_role
 *   can write them without a cross-schema write.
 */
export class ListingExpiry1735000033000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD COLUMN published_at timestamptz,
        ADD COLUMN expires_at timestamptz,
        ADD COLUMN deleted_at timestamptz
    `);

    await queryRunner.query(`
      UPDATE marketplace.vehicles
      SET status = 'ARCHIVED'
      WHERE status = 'SOLD'
    `);

    await queryRunner.query(`
      UPDATE marketplace.vehicles
      SET published_at = updated_at,
          expires_at = updated_at + interval '90 days'
      WHERE status = 'LIVE' AND published_at IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP CONSTRAINT vehicles_status_check
    `);
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD CONSTRAINT vehicles_status_check
        CHECK (status IN ('DRAFT','PENDING_REVIEW','LIVE','ARCHIVED','REJECTED'))
    `);

    await queryRunner.query(`
      DROP INDEX marketplace.idx_vehicles_registration_number
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_vehicles_active_registration_number
      ON marketplace.vehicles (registration_number)
      WHERE registration_number IS NOT NULL
        AND deleted_at IS NULL
        AND status IN ('DRAFT','PENDING_REVIEW','LIVE')
    `);

    await queryRunner.query(`
      CREATE INDEX idx_vehicles_live_expires_at
      ON marketplace.vehicles (expires_at)
      WHERE status = 'LIVE'
    `);

    await queryRunner.query(`
      CREATE TABLE marketplace.deleted_listing_snapshots (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id          uuid NOT NULL,
        dealer_id           uuid NOT NULL,
        registration_number varchar(50),
        snapshot            jsonb NOT NULL,
        deleted_by          uuid NOT NULL,
        deleted_at          timestamptz NOT NULL DEFAULT now(),
        purge_after         timestamptz NOT NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_deleted_listing_snapshots_purge_after
      ON marketplace.deleted_listing_snapshots (purge_after)
    `);

    await queryRunner.query(`
      CREATE TABLE marketplace.listing_audit_log (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        action              varchar(40) NOT NULL,
        vehicle_id          uuid NOT NULL,
        dealer_id           uuid NOT NULL,
        registration_number varchar(50),
        actor_id            uuid,
        details             jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_listing_audit_log_vehicle_id
      ON marketplace.listing_audit_log (vehicle_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS marketplace.listing_audit_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS marketplace.deleted_listing_snapshots`);
    await queryRunner.query(`DROP INDEX IF EXISTS marketplace.idx_vehicles_live_expires_at`);

    await queryRunner.query(`DROP INDEX marketplace.idx_vehicles_active_registration_number`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_vehicles_registration_number
      ON marketplace.vehicles (registration_number)
      WHERE registration_number IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP CONSTRAINT vehicles_status_check
    `);
    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        ADD CONSTRAINT vehicles_status_check
        CHECK (status IN ('DRAFT','PENDING_REVIEW','LIVE','SOLD','ARCHIVED','REJECTED'))
    `);

    await queryRunner.query(`
      ALTER TABLE marketplace.vehicles
        DROP COLUMN deleted_at,
        DROP COLUMN expires_at,
        DROP COLUMN published_at
    `);
  }
}
