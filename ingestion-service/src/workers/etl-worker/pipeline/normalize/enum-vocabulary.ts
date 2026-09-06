import type { VehicleType } from '../../../../infrastructure/database/entities/vehicle.write-entity';
import { compact } from './trigram';

/**
 * Closed-vocabulary synonyms for the enum columns.
 *
 * Copied from marketplace-service/src/modules/search/parser/vocabulary.ts for
 * the same reason trigram.ts is: ingestion and search must fold the same word
 * to the same value. If a dealer uploads "deisel" and we store DIESEL, a buyer
 * typing "deisel" has to reach that row — and search already accepts these
 * misspellings. Diverging here would make bulk stock invisible to exactly the
 * queries it should match.
 *
 * Deliberately excluded: driveType and bodyType singles. Those are not columns
 * on marketplace.vehicles; body type is resolved through the BODY_TYPE
 * dictionary in the enrich stage (§A6) so it stays seed-driven.
 */

export const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const TRANSMISSION_TYPES = [
  'MANUAL',
  'AUTOMATIC',
  'CVT',
  'SEMI_AUTOMATIC',
] as const;
export type TransmissionType = (typeof TRANSMISSION_TYPES)[number];

export const CONDITIONS = ['NEW', 'USED', 'RECONDITIONED'] as const;
export type Condition = (typeof CONDITIONS)[number];

/**
 * All 11 values. marketplace-service's CreateListingDto still declares only 6
 * — migration 20000 extended the CHECK constraint and the entity union without
 * widening that DTO. The entity is authoritative: a bulk row typed LORRY is
 * valid in the database, so the ETL accepts it.
 */
export const VEHICLE_TYPES: readonly VehicleType[] = [
  'CAR',
  'BIKE',
  'VAN',
  'TRUCK',
  'SUV',
  'BUS',
  'THREE_WHEELER',
  'LORRY',
  'PICKUP',
  'TRACTOR',
  'HEAVY_MACHINERY',
];

/** compact()-ed key → canonical value. Keys carry no spaces or punctuation. */
const FUEL: Record<string, FuelType> = {
  petrol: 'PETROL',
  gasoline: 'PETROL',
  gas: 'PETROL',
  diesel: 'DIESEL',
  deisel: 'DIESEL',
  disel: 'DIESEL',
  deesel: 'DIESEL',
  hybrid: 'HYBRID',
  hyrbid: 'HYBRID',
  hybird: 'HYBRID',
  petrolhybrid: 'HYBRID',
  pluginhybrid: 'HYBRID',
  phev: 'HYBRID',
  electric: 'ELECTRIC',
  fullyelectric: 'ELECTRIC',
  ev: 'ELECTRIC',
  cng: 'CNG',
};

const TRANSMISSION: Record<string, TransmissionType> = {
  manual: 'MANUAL',
  manualtransmission: 'MANUAL',
  mt: 'MANUAL',
  automatic: 'AUTOMATIC',
  auto: 'AUTOMATIC',
  at: 'AUTOMATIC',
  autotransmission: 'AUTOMATIC',
  automatictransmission: 'AUTOMATIC',
  cvt: 'CVT',
  semiautomatic: 'SEMI_AUTOMATIC',
  semiauto: 'SEMI_AUTOMATIC',
  tiptronic: 'SEMI_AUTOMATIC',
};

const CONDITION: Record<string, Condition> = {
  new: 'NEW',
  brandnew: 'NEW',
  unregistered: 'NEW',
  used: 'USED',
  secondhand: 'USED',
  preowned: 'USED',
  registered: 'USED',
  reconditioned: 'RECONDITIONED',
  reconditioned2: 'RECONDITIONED',
  recon: 'RECONDITIONED',
};

const VEHICLE_TYPE: Record<string, VehicleType> = {
  car: 'CAR',
  cars: 'CAR',
  motorcar: 'CAR',
  bike: 'BIKE',
  bikes: 'BIKE',
  motorbike: 'BIKE',
  motorcycle: 'BIKE',
  scooter: 'BIKE',
  van: 'VAN',
  vans: 'VAN',
  minivan: 'VAN',
  truck: 'TRUCK',
  trucks: 'TRUCK',
  suv: 'SUV',
  suvs: 'SUV',
  jeep: 'SUV',
  bus: 'BUS',
  buses: 'BUS',
  threewheeler: 'THREE_WHEELER',
  threewheel: 'THREE_WHEELER',
  tuk: 'THREE_WHEELER',
  tuktuk: 'THREE_WHEELER',
  trishaw: 'THREE_WHEELER',
  lorry: 'LORRY',
  lorries: 'LORRY',
  pickup: 'PICKUP',
  pickups: 'PICKUP',
  cab: 'PICKUP',
  doublecab: 'PICKUP',
  singlecab: 'PICKUP',
  tractor: 'TRACTOR',
  tractors: 'TRACTOR',
  heavymachinery: 'HEAVY_MACHINERY',
  heavyequipment: 'HEAVY_MACHINERY',
  machinery: 'HEAVY_MACHINERY',
};

/**
 * Enum coercion is exact-or-nothing — no fuzzy fallback.
 *
 * A closed vocabulary has few members and short words, so trigram matching
 * between them is unreliable in the worst way: "MANUAL" and "AUTOMATIC" are far
 * apart, but a typo landing between two fuel types would silently mislabel a
 * vehicle. Unknown values return null, which parseNormalize records as a
 * confidence miss and routes to Groq — where the whole row gives context a
 * three-letter cell cannot.
 */
export function coerceFuelType(raw: string | undefined): FuelType | null {
  return lookup(FUEL, raw);
}

export function coerceTransmission(raw: string | undefined): TransmissionType | null {
  return lookup(TRANSMISSION, raw);
}

export function coerceCondition(raw: string | undefined): Condition | null {
  return lookup(CONDITION, raw);
}

export function coerceVehicleType(raw: string | undefined): VehicleType | null {
  return lookup(VEHICLE_TYPE, raw);
}

function lookup<T>(table: Record<string, T>, raw: string | undefined): T | null {
  if (!raw) return null;
  return table[compact(raw)] ?? null;
}
