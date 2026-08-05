import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketplaceFavourites1735000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE marketplace.favourites (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        vehicle_id uuid NOT NULL REFERENCES marketplace.vehicles(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_favourites_buyer_vehicle UNIQUE (buyer_id, vehicle_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_favourites_buyer_id ON marketplace.favourites (buyer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_favourites_vehicle_id ON marketplace.favourites (vehicle_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE marketplace.favourites`);
  }
}
