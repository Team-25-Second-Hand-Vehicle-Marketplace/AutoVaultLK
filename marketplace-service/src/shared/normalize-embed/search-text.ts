export type SearchTextFields = {
  make: string;
  model: string;
  manufactureYear: number;
  vehicleType: string;
  condition?: string | null;
  fuelType?: string | null;
  transmissionType?: string | null;
  price?: number | null;
  mileage?: number | null;
  locationCity?: string | null;
  locationDistrict?: string | null;
  specs?: Record<string, unknown> | null;
  description?: string | null;
};

/**
 * Builds the text that becomes a listing's `search_text` and, through MiniLM,
 * its embedding vector.
 *
 * ⚠️ **This file is duplicated in ingestion-service and must stay
 * byte-identical.** A vector is only meaningful relative to vectors built the
 * same way, so if the two copies diverge, bulk-uploaded listings land in a
 * different region of vector space and rank badly forever — with no error, no
 * failing test and no log line (FR-22.1 / NFR-26.1, plan-b §9A).
 *
 * Changing anything here also **invalidates every embedding already stored**.
 * The full change procedure is:
 *   1. edit both copies identically (the parity test enforces this)
 *   2. add any new field to SEARCHABLE_FIELDS in listing.repository.ts, or an
 *      edit to it will leave a stale vector behind
 *   3. re-run `cd database && npm run seed:embeddings`
 *   4. note it in the plan-b §9A drift checklist
 */
export function buildSearchText(fields: SearchTextFields): string {
  const bodyType = fields.specs?.['body_type'];

  return [
    fields.make,
    fields.model,
    String(fields.manufactureYear),
    fields.vehicleType,
    fields.condition,
    fields.fuelType,
    fields.transmissionType,
    fields.locationCity,
    fields.locationDistrict,
    typeof bodyType === 'string' ? bodyType : null,
    priceBand(fields.price),
    mileageBand(fields.mileage),
    ageBand(fields.manufactureYear),
    equipmentTerms(fields.specs),
    fields.description,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Price as a phrase, not a number.
 *
 * MiniLM tokenizes "3500000" as digit fragments with no numeric meaning —
 * "3,500,000" and "3,400,000" are not near each other in vector space, so
 * embedding the raw figure adds noise rather than signal. A band is a word the
 * model has seen in context, which is what lets "cheap family car" reach a
 * budget listing.
 *
 * Exact price filtering is a SQL WHERE clause and always has been; the
 * embedding carries what SQL cannot express.
 *
 * Bands are in LKR and reflect the Sri Lankan market, where a "budget" car is
 * under ~2M and anything past 25M is genuinely luxury.
 */
function priceBand(price: number | null | undefined): string | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;

  if (price < 2_000_000) return 'budget affordable low price';
  if (price < 5_000_000) return 'mid range moderately priced';
  if (price < 10_000_000) return 'upper mid range';
  if (price < 25_000_000) return 'premium expensive';
  return 'luxury high end';
}

/** Same argument as priceBand: "45000" is not a concept, "low mileage" is. */
function mileageBand(mileage: number | null | undefined): string | null {
  if (mileage == null || !Number.isFinite(mileage) || mileage < 0) return null;

  if (mileage < 20_000) return 'low mileage lightly used';
  if (mileage < 60_000) return 'moderate mileage';
  if (mileage < 120_000) return 'high mileage';
  return 'very high mileage well used';
}

/**
 * Relative age, because buyers search in relative terms — "recent model",
 * "old car" — while the year alone only matches a query naming that year.
 *
 * Computed against the current year, so a listing re-embedded later gets the
 * band that is true then. That is a deliberate consequence: it means the text
 * is not stable across re-seeds, and two vehicles of the same year embedded a
 * decade apart differ. Acceptable, because re-seeding is a bulk operation that
 * moves every listing together.
 */
function ageBand(manufactureYear: number): string | null {
  if (!Number.isFinite(manufactureYear)) return null;

  const age = new Date().getFullYear() - manufactureYear;
  if (age < 0) return null;

  if (age <= 2) return 'brand new recent model';
  if (age <= 5) return 'nearly new';
  if (age <= 10) return 'used';
  if (age <= 20) return 'older model';
  return 'vintage old';
}

/**
 * Equipment the dealer declared, as searchable words.
 *
 * Only keys that are true — an absent or false sunroof is not something a
 * buyer searches for, and emitting "no sunroof" would pull the listing toward
 * queries mentioning sunroofs.
 *
 * Keys are read from specs rather than listed here so a new KNOWN_SPEC_KEY
 * becomes searchable without touching this file. Sorted for determinism: the
 * same vehicle must produce the same text on every run, or its vector moves
 * for no reason.
 */
function equipmentTerms(specs: Record<string, unknown> | null | undefined): string | null {
  if (!specs) return null;

  const terms = Object.entries(specs)
    .filter(([key, value]) => value === true && key !== 'body_type')
    .map(([key]) => key.replace(/_/g, ' '))
    .sort();

  return terms.length > 0 ? terms.join(' ') : null;
}
