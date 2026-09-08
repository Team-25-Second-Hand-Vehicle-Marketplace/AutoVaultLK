import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EmbeddedRow, Rejection } from '../types';
import { rejection } from '../types';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONE CROSS-SCHEMA WRITE IN THE PLATFORM (ADR-002)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ingestion_service_role holds SELECT + INSERT + UPDATE on marketplace.vehicles
 * and marketplace.vehicle_images — and DELETE on neither. That grant is the
 * single documented exception to schema ownership (database/src/grants.sql,
 * Documentation/plan-b-reads-cross-schemas.md §6), and the exception is only
 * defensible while it is confined to one class.
 *
 * **No other file in ingestion-service may write marketplace.\*.** If you need
 * a new cross-schema write — images, spec backfill, anything — add a method
 * here. A second writer does not break a test; it dissolves the architectural
 * claim the whole design rests on, silently.
 *
 * NEVER emit DELETE. The role lacks the grant, so it fails at runtime rather
 * than review — but the reason it lacks the grant is that ETL must not be able
 * to destroy a dealer's manually created listings.
 */
@Injectable()
export class MarketplaceVehiclesWriteAdapter {
  private readonly logger = new Logger(MarketplaceVehiclesWriteAdapter.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Upserts a batch and returns what landed, plus rows the database refused.
   *
   * Batched for throughput, then retried row-by-row on conflict: a chunk of 250
   * rows is one statement in the common case, and only degrades to individual
   * inserts when a duplicate registration is actually present.
   */
  async upsertBatch(
    jobId: string,
    dealerId: string,
    rows: EmbeddedRow[],
  ): Promise<UpsertResult> {
    if (rows.length === 0) return { loaded: [], rejections: [] };

    try {
      const loaded = await this.insertMany(jobId, dealerId, rows);
      return { loaded, rejections: [] };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;

      // A batch INSERT aborts entirely on the first constraint violation, so
      // the 249 good rows travelling with one duplicate would be lost. Fall
      // back to per-row isolation to find out which row is actually at fault.
      this.logger.debug(
        `Batch upsert hit a unique violation for job ${jobId}; isolating ${rows.length} rows`,
      );
      return this.insertIndividually(jobId, dealerId, rows);
    }
  }

  /**
   * How many vehicles this job has actually landed.
   *
   * The orchestrator counts from here rather than tallying its own outcomes,
   * because a resumed run loads nothing new — the rows belong to the previous
   * run — and tallying this run alone would report zero and downgrade a
   * finished job to FAILED.
   */
  async countForJob(jobId: string): Promise<number> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM marketplace.vehicles WHERE upload_job_id = $1`,
      [jobId],
    )) as { count: number }[];

    return row?.count ?? 0;
  }

  private async insertMany(
    jobId: string,
    dealerId: string,
    rows: EmbeddedRow[],
  ): Promise<LoadedVehicle[]> {
    const values: string[] = [];
    const params: unknown[] = [];

    for (const row of rows) {
      const start = params.length;
      params.push(...this.parametersFor(jobId, dealerId, row));
      values.push(placeholders(start));
    }

    const result = (await this.dataSource.query(
      `${INSERT_SQL} VALUES ${values.join(', ')} ${ON_CONFLICT_SQL} ${RETURNING_SQL}`,
      params,
    )) as LoadedVehicle[];

    return result;
  }

  private async insertIndividually(
    jobId: string,
    dealerId: string,
    rows: EmbeddedRow[],
  ): Promise<UpsertResult> {
    const loaded: LoadedVehicle[] = [];
    const rejections: Rejection[] = [];

    for (const row of rows) {
      try {
        const result = (await this.dataSource.query(
          `${INSERT_SQL} VALUES ${placeholders(0)} ${ON_CONFLICT_SQL} ${RETURNING_SQL}`,
          this.parametersFor(jobId, dealerId, row),
        )) as LoadedVehicle[];

        if (result[0]) loaded.push(result[0]);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;

        // The GLOBAL partial unique on registration_number (FR-35.1, migration
        // 6000) — not the composite upsert key. It fires when a dealer
        // re-uploads a vehicle already listed under a DIFFERENT job, which the
        // ON CONFLICT target cannot catch because the job ids differ.
        rejections.push(
          rejection(
            row,
            `registration_number ${row.normalized.registrationNumber ?? ''} is already listed`.trim(),
          ),
        );
      }
    }

    return { loaded, rejections };
  }

  /** Column order must match INSERT_SQL and placeholders(). */
  private parametersFor(jobId: string, dealerId: string, row: EmbeddedRow): unknown[] {
    const f = row.normalized;

    return [
      // dealer_id comes from the JOB, never the CSV. A dealer_id column in an
      // uploaded file must not be able to assign stock to another dealer.
      dealerId,
      jobId,
      f.vehicleType,
      f.make,
      f.model,
      f.condition,
      f.manufactureYear,
      f.registrationYear ?? null,
      f.price,
      f.isNegotiable ?? false,
      f.mileage,
      f.fuelType ?? null,
      f.transmissionType ?? null,
      f.engineCapacityCc ?? null,
      f.color ?? null,
      f.ownersCount ?? null,
      f.locationCity ?? null,
      f.locationDistrict ?? null,
      f.registrationNumber ?? null,
      f.chassisNumber ?? null,
      f.description ?? null,
      JSON.stringify(f.specs ?? {}),
      row.searchText,
      row.embedding,
    ];
  }
}

export type LoadedVehicle = {
  id: string;
  registration_number: string | null;
};

export type UpsertResult = {
  loaded: LoadedVehicle[];
  rejections: Rejection[];
};

/**
 * status is always PENDING_REVIEW: bulk stock is reviewed before going live
 * (FR-33), and a dealer CSV must not be able to publish listings directly.
 *
 * search_vector is absent by design — trg_vehicles_search_vector fills it
 * BEFORE INSERT OR UPDATE OF search_text (migration 14000). Writing the column
 * here would either be overwritten by the trigger or, worse, drift from
 * search_text if the trigger were ever dropped.
 */
const INSERT_SQL = `
  INSERT INTO marketplace.vehicles (
    dealer_id, upload_job_id, vehicle_type, make, model, condition,
    manufacture_year, registration_year, price, is_negotiable, mileage,
    fuel_type, transmission_type, engine_capacity_cc, color, owners_count,
    location_city, location_district, registration_number, chassis_number,
    description, specs, search_text, embedding, status
  )`;

/**
 * The upsert key is the composite partial index from migration 19000, so the
 * conflict target must repeat its WHERE clause — a partial index only matches
 * an ON CONFLICT that names the same predicate.
 *
 * DO UPDATE, never DO NOTHING: a dealer re-uploading a corrected file expects
 * the corrections to land. updated_at is set explicitly because ON CONFLICT
 * bypasses TypeORM's @UpdateDateColumn.
 */
const ON_CONFLICT_SQL = `
  ON CONFLICT (upload_job_id, registration_number)
    WHERE upload_job_id IS NOT NULL AND registration_number IS NOT NULL
  DO UPDATE SET
    vehicle_type = EXCLUDED.vehicle_type,
    make = EXCLUDED.make,
    model = EXCLUDED.model,
    condition = EXCLUDED.condition,
    manufacture_year = EXCLUDED.manufacture_year,
    registration_year = EXCLUDED.registration_year,
    price = EXCLUDED.price,
    is_negotiable = EXCLUDED.is_negotiable,
    mileage = EXCLUDED.mileage,
    fuel_type = EXCLUDED.fuel_type,
    transmission_type = EXCLUDED.transmission_type,
    engine_capacity_cc = EXCLUDED.engine_capacity_cc,
    color = EXCLUDED.color,
    owners_count = EXCLUDED.owners_count,
    location_city = EXCLUDED.location_city,
    location_district = EXCLUDED.location_district,
    chassis_number = EXCLUDED.chassis_number,
    description = EXCLUDED.description,
    specs = EXCLUDED.specs,
    search_text = EXCLUDED.search_text,
    embedding = EXCLUDED.embedding,
    updated_at = now()`;

/** Keys the image-branch join (§B3), which matches files by registration number. */
const RETURNING_SQL = `RETURNING id, registration_number`;

const COLUMN_COUNT = 24;

/**
 * $1..$24 for one row, offset into the batch. The embedding is text on the way
 * in and cast here — pgvector accepts '[0.1,0.2,...]'::vector, and passing it
 * as a bare parameter would be rejected as an unknown type.
 */
function placeholders(offset: number): string {
  const slots = Array.from({ length: COLUMN_COUNT }, (_, i) => `$${offset + i + 1}`);

  // specs is jsonb, embedding is vector; the rest infer from the column type.
  slots[21] = `${slots[21]}::jsonb`;
  slots[23] = `${slots[23]}::vector`;

  return `(${slots.join(', ')}, 'PENDING_REVIEW')`;
}

/** Postgres unique_violation. Anything else is infrastructure and must propagate. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}
