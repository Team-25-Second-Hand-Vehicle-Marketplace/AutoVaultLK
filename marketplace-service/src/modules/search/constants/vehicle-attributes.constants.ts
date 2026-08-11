/**
 * Mirrors the live CHECK constraints on marketplace.vehicles exactly.
 * A parity test (Phase 5) reads information_schema and asserts these arrays
 * match the database — edit a migration, this file drifts, CI catches it
 * before a filter silently rejects a valid value.
 *
 * Do not add values here without a corresponding CHECK constraint update in
 * database/src/migrations, and vice versa.
 */

export const VEHICLE_TYPES = [
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
] as const;
export type VehicleTypeValue = (typeof VEHICLE_TYPES)[number];

export const CONDITIONS = ['NEW', 'USED', 'RECONDITIONED'] as const;
export type ConditionValue = (typeof CONDITIONS)[number];

export const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG'] as const;
export type FuelTypeValue = (typeof FUEL_TYPES)[number];

export const TRANSMISSION_TYPES = ['MANUAL', 'AUTOMATIC', 'CVT', 'SEMI_AUTOMATIC'] as const;
export type TransmissionTypeValue = (typeof TRANSMISSION_TYPES)[number];

export const VEHICLE_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'LIVE',
  'SOLD',
  'ARCHIVED',
  'REJECTED',
] as const;

// The only status buyer-facing search is ever allowed to return.
// Design doc §10: every buyer-facing query gates on status first.
export const SEARCHABLE_STATUS = 'LIVE' as const;

export const DEALER_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

// Sort options. "relevance" with no keyword query falls back to recency —
// design doc §9: no blended score when there is no semantic text.
export const SORT_OPTIONS = [
  'relevance',
  'price_asc',
  'price_desc',
  'year_desc',
  'mileage_asc',
  'newest',
] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
