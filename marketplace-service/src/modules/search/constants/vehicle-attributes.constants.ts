
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


export const SEARCHABLE_STATUS = 'LIVE' as const;

export const DEALER_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;

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
