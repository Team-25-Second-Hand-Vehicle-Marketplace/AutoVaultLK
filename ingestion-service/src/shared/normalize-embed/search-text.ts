export type SearchTextFields = {
  make: string;
  model: string;
  manufactureYear: number;
  vehicleType: string;
  fuelType?: string | null;
  transmissionType?: string | null;
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
    fields.fuelType,
    fields.transmissionType,
    fields.locationCity,
    fields.locationDistrict,
    typeof bodyType === 'string' ? bodyType : null,
    fields.description,
  ]
    .filter(Boolean)
    .join(' ');
}
