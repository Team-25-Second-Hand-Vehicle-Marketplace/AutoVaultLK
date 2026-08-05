import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketplaceVehicleImages1735000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE marketplace.vehicle_images (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id     uuid NOT NULL REFERENCES marketplace.vehicles(id) ON DELETE CASCADE,
        s3_path        varchar(500) NOT NULL,
        processed_path varchar(500),
        thumbnail_path varchar(500),
        is_primary     boolean NOT NULL DEFAULT false,
        display_order  integer NOT NULL DEFAULT 0,
        created_at     timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_vehicle_images_vehicle_id ON marketplace.vehicle_images (vehicle_id)`,
    );
    // At most one primary image per vehicle
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_vehicle_images_one_primary
      ON marketplace.vehicle_images (vehicle_id)
      WHERE is_primary
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE marketplace.vehicle_images`);
  }
}
