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

function equipmentTerms(specs: Record<string, unknown> | null | undefined): string | null {
  if (!specs) return null;

  const terms = Object.entries(specs)
    .filter(([key, value]) => value === true && key !== 'body_type')
    .map(([key]) => key.replace(/_/g, ' '))
    .sort();

  return terms.length > 0 ? terms.join(' ') : null;
}
