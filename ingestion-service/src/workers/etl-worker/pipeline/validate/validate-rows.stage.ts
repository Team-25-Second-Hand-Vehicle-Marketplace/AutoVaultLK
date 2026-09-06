import { CONDITIONS, VEHICLE_TYPES } from '../normalize/enum-vocabulary';
import {
  rejection,
  type NormalizedRow,
  type Rejection,
  type StageContext,
  type StageResult,
  type StageRunner,
  type ValidatedRow,
  type VehicleFields,
} from '../types';

/**
 * Bounds, mirroring marketplace-service/src/modules/listings/dto/
 * create-listing.dto.ts so bulk and manual listings obey identical rules. A
 * vehicle a dealer could not create through the UI must not arrive through a
 * spreadsheet.
 */
export const MIN_YEAR = 1980;

/** numeric(14,2): 12 digits before the decimal. Beyond that the INSERT throws. */
export const MAX_PRICE = 999_999_999_999;

/** integer mileage. A plausible ceiling, well inside the column's range. */
export const MAX_MILEAGE = 10_000_000;

/** smallint columns — manufacture_year, registration_year, owners_count. */
const SMALLINT_MAX = 32_767;

const MAX_LENGTHS: Partial<Record<keyof VehicleFields, number>> = {
  make: 100,
  model: 100,
  color: 50,
  locationCity: 100,
  locationDistrict: 100,
  registrationNumber: 50,
  chassisNumber: 100,
};

/**
 * The gate. Every row that reaches Load has passed through here, and every
 * rejection reason in the platform originates here — parseNormalize
 * deliberately rejects nothing so this stays the single list.
 *
 * Two categories of check, for different reasons:
 *
 * 1. **Business rules** mirroring the manual-listing DTO, so a dealer cannot
 *    bulk-upload a vehicle they could not have created through the UI.
 *
 * 2. **Column bounds** — smallint ranges, varchar lengths, numeric precision.
 *    These are not pedantry: an over-long `make` or a year of 99999 raises at
 *    INSERT time, and because Load batches rows, one such value would fail
 *    every good row travelling with it. Catching them here turns a lost batch
 *    into one rejected row with a reason the dealer can act on.
 */
export const validateRowsStage: StageRunner<
  NormalizedRow[],
  StageResult<ValidatedRow>
> = {
  stage: 'VALIDATE_ROWS',

  async run(_ctx: StageContext, rows: NormalizedRow[]): Promise<StageResult<ValidatedRow>> {
    const valid: ValidatedRow[] = [];
    const rejections: Rejection[] = [];

    // Row number of the first row claiming each registration. Duplicates are
    // resolved against the winner, so the message can name it.
    const seenRegistrations = new Map<string, number>();

    for (const row of rows) {
      const reasons = checkRow(row);

      // Intra-job duplicates must die here, before fan-out. Two rows sharing a
      // registration number would upsert over each other under
      // idx_vehicles_job_registration — the second silently overwriting the
      // first, with no error and no rejected record. The dealer would see
      // "50 loaded" for 51 rows and never learn which vanished.
      const registration = row.normalized.registrationNumber;
      if (registration) {
        const firstSeen = seenRegistrations.get(registration);
        if (firstSeen !== undefined) {
          reasons.push(
            `duplicate registration_number "${registration}" (also on row ${firstSeen})`,
          );
        } else if (reasons.length === 0) {
          // Only a row that will actually be loaded claims the number. A
          // rejected row must not shadow a good one further down the file.
          seenRegistrations.set(registration, row.rowNumber);
        }
      }

      if (reasons.length > 0) {
        rejections.push(rejection(row, reasons.join('; ')));
      } else {
        valid.push(row as ValidatedRow);
      }
    }

    return { rows: valid, rejections };
  },
};

function checkRow(row: NormalizedRow): string[] {
  const reasons: string[] = [];
  const f = row.normalized;

  // --- required ----------------------------------------------------------
  // Absent means parseNormalize could not resolve or parse it. The raw cell is
  // named so the dealer can see what they wrote versus what we could not read.
  if (!f.make) reasons.push(missing('make', row));
  if (!f.model) reasons.push(missing('model', row));
  if (f.manufactureYear === undefined) reasons.push(missing('year', row));
  if (f.price === undefined) reasons.push(missing('price', row));
  if (f.mileage === undefined) reasons.push(missing('mileage', row));

  // vehicleType and condition are required by the column but supplied by
  // derivation and defaulting rather than by the dealer, so an absent value
  // here is not reported as a missing cell — enrich fills them. Only a value
  // that is present and invalid is worth rejecting.
  if (f.vehicleType !== undefined && !VEHICLE_TYPES.includes(f.vehicleType)) {
    reasons.push(`vehicle_type "${f.vehicleType}" is not a recognised type`);
  }
  if (f.condition !== undefined && !CONDITIONS.includes(f.condition as never)) {
    reasons.push(`condition "${f.condition}" is not one of NEW, USED, RECONDITIONED`);
  }

  // --- ranges ------------------------------------------------------------
  const maxYear = new Date().getFullYear() + 1;

  if (f.manufactureYear !== undefined) {
    if (f.manufactureYear < MIN_YEAR || f.manufactureYear > maxYear) {
      reasons.push(`year ${f.manufactureYear} is outside ${MIN_YEAR}–${maxYear}`);
    }
  }

  if (f.registrationYear !== undefined && f.registrationYear !== null) {
    if (f.registrationYear < MIN_YEAR || f.registrationYear > maxYear) {
      reasons.push(`registration_year ${f.registrationYear} is outside ${MIN_YEAR}–${maxYear}`);
    } else if (f.manufactureYear !== undefined && f.registrationYear < f.manufactureYear) {
      // A vehicle cannot be registered before it was built. Usually the two
      // columns have been swapped.
      reasons.push(
        `registration_year ${f.registrationYear} precedes manufacture year ${f.manufactureYear}`,
      );
    }
  }

  if (f.price !== undefined) {
    if (f.price <= 0) reasons.push(`price must be greater than 0, got ${f.price}`);
    else if (f.price > MAX_PRICE) reasons.push(`price ${f.price} exceeds the maximum`);
  }

  if (f.mileage !== undefined) {
    if (f.mileage < 0) reasons.push(`mileage cannot be negative, got ${f.mileage}`);
    else if (f.mileage > MAX_MILEAGE) reasons.push(`mileage ${f.mileage} is implausible`);
  }

  if (f.engineCapacityCc !== undefined && f.engineCapacityCc !== null) {
    if (f.engineCapacityCc <= 0) {
      reasons.push(`engine_capacity_cc must be greater than 0, got ${f.engineCapacityCc}`);
    }
  }

  if (f.ownersCount !== undefined && f.ownersCount !== null) {
    if (f.ownersCount < 0 || f.ownersCount > SMALLINT_MAX) {
      reasons.push(`owners_count ${f.ownersCount} is out of range`);
    }
  }

  // --- column widths -----------------------------------------------------
  // Truncating instead would silently corrupt a chassis number or a plate.
  for (const [field, limit] of Object.entries(MAX_LENGTHS)) {
    const value = f[field as keyof VehicleFields];
    if (typeof value === 'string' && value.length > limit) {
      reasons.push(`${snake(field)} exceeds ${limit} characters`);
    }
  }

  return reasons;
}

/**
 * "make is missing" versus 'make "Lamborghini" could not be matched' — the
 * dealer needs to know whether they left a cell blank or wrote something the
 * dictionary does not carry. Those call for different fixes.
 */
function missing(column: string, row: NormalizedRow): string {
  const raw = row.raw[column]?.trim();
  return raw
    ? `${column} "${raw}" could not be recognised`
    : `${column} is missing`;
}

function snake(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
