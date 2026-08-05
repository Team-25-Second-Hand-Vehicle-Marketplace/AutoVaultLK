import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketplaceVehicles1735000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE marketplace.vehicles (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dealer_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        upload_job_id       uuid REFERENCES ingestion.upload_jobs(id) ON DELETE SET NULL,

        vehicle_type        varchar(20) NOT NULL DEFAULT 'CAR'
                            CHECK (vehicle_type IN ('CAR','BIKE','VAN','TRUCK','SUV','BUS')),
        make                varchar(100) NOT NULL,
        model               varchar(100) NOT NULL,
        condition           varchar(20)  NOT NULL DEFAULT 'USED'
                            CHECK (condition IN ('NEW','USED','RECONDITIONED')),

        manufacture_year    smallint NOT NULL,
        registration_year   smallint,
        price               numeric(14,2) NOT NULL,
        is_negotiable       boolean NOT NULL DEFAULT false,
        mileage             integer NOT NULL,
        fuel_type           varchar(20)
                            CHECK (fuel_type IN ('PETROL','DIESEL','HYBRID','ELECTRIC','CNG')),
        transmission_type   varchar(20)
                            CHECK (transmission_type IN ('MANUAL','AUTOMATIC','CVT','SEMI_AUTOMATIC')),
        engine_capacity_cc  integer,
        color               varchar(50),
        owners_count        smallint,

        location_city       varchar(100),
        location_district   varchar(100),
        registration_number varchar(50),
        chassis_number      varchar(100),
        description         text,

        -- Raw dealer values kept alongside corrected ones, for audit.
        -- A systematic misspelling across many rows is a broken feed,
        -- not many individual typos.
        make_raw            varchar(100),
        model_raw            varchar(100),

        status              varchar(20) NOT NULL DEFAULT 'PENDING_REVIEW'
                            CHECK (status IN ('DRAFT','PENDING_REVIEW','LIVE','SOLD','ARCHIVED','REJECTED')),

        -- Type-specific attributes (body_type, seats, doors, sunroof,
        -- airbags, drive_type, etc.) live HERE, not as columns. A bike has
        -- no body_type, a truck has no seats. New vehicle types need no
        -- schema change. Backing dictionary for KNOWN_SPEC_KEYS keys.
        specs               jsonb NOT NULL DEFAULT '{}'::jsonb,

        -- Built by Enrich from the columns above + description.
        -- No band words — enrichment derivations (age/slug/price_band/
        -- mileage_band) were deliberately removed.
        search_text         text,

        -- 384 dims = all-MiniLM-L6-v2. Model parity between ingest and
        -- search is mandatory or results are silently wrong.
        embedding           vector(384),
        search_vector       tsvector,

        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Keys the image-branch join. Partial unique: blank registration numbers
    // are legitimate (unregistered imports) and must not collide with each
    // other. Duplicates among non-null values are rejected at ingest time.
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_vehicles_registration_number
      ON marketplace.vehicles (registration_number)
      WHERE registration_number IS NOT NULL
    `);

    await queryRunner.query(
      `CREATE INDEX idx_vehicles_dealer_id ON marketplace.vehicles (dealer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_vehicles_upload_job_id ON marketplace.vehicles (upload_job_id)`,
    );
    await queryRunner.query(`CREATE INDEX idx_vehicles_status ON marketplace.vehicles (status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE marketplace.vehicles`);
  }
}
