import {
  VEHICLE_TYPES,
  coerceCondition,
  coerceFuelType,
  coerceTransmission,
  coerceVehicleType,
} from '../../../../src/workers/etl-worker/pipeline/normalize/enum-vocabulary';

describe('coerceFuelType', () => {
  it.each([
    ['Petrol', 'PETROL'],
    ['PETROL', 'PETROL'],
    ['gasoline', 'PETROL'],
    ['Diesel', 'DIESEL'],
    ['hybrid', 'HYBRID'],
    ['Petrol Hybrid', 'HYBRID'],
    ['EV', 'ELECTRIC'],
    ['electric', 'ELECTRIC'],
    ['CNG', 'CNG'],
  ])('maps %s', (input, expected) => {
    expect(coerceFuelType(input)).toBe(expected);
  });

  it.each([['deisel'], ['disel'], ['deesel']])('accepts the misspelling %s', (input) => {
    // Search's parser already accepts these (vocabulary.ts). If ingestion did
    // not, a dealer typing "deisel" would store an unresolved value that the
    // buyer typing the same word could never reach.
    expect(coerceFuelType(input)).toBe('DIESEL');
  });

  it.each([['hyrbid'], ['hybird']])('accepts the misspelling %s', (input) => {
    expect(coerceFuelType(input)).toBe('HYBRID');
  });

  it('returns null for an unknown value rather than guessing', () => {
    // No fuzzy fallback: a closed vocabulary has short words, and a typo
    // landing between two fuel types would silently mislabel the vehicle.
    expect(coerceFuelType('petro-diesel')).toBeNull();
    expect(coerceFuelType('')).toBeNull();
    expect(coerceFuelType(undefined)).toBeNull();
  });
});

describe('coerceTransmission', () => {
  it.each([
    ['Automatic', 'AUTOMATIC'],
    ['auto', 'AUTOMATIC'],
    ['AT', 'AUTOMATIC'],
    ['Manual', 'MANUAL'],
    ['MT', 'MANUAL'],
    ['CVT', 'CVT'],
    ['semi automatic', 'SEMI_AUTOMATIC'],
    ['Tiptronic', 'SEMI_AUTOMATIC'],
  ])('maps %s', (input, expected) => {
    expect(coerceTransmission(input)).toBe(expected);
  });
});

describe('coerceCondition', () => {
  it.each([
    ['Used', 'USED'],
    ['second hand', 'USED'],
    ['pre-owned', 'USED'],
    ['Brand New', 'NEW'],
    ['Reconditioned', 'RECONDITIONED'],
    ['recon', 'RECONDITIONED'],
  ])('maps %s', (input, expected) => {
    expect(coerceCondition(input)).toBe(expected);
  });
});

describe('coerceVehicleType', () => {
  it.each([
    ['Car', 'CAR'],
    ['SUV', 'SUV'],
    ['jeep', 'SUV'],
    ['three wheeler', 'THREE_WHEELER'],
    ['tuk tuk', 'THREE_WHEELER'],
    ['Lorry', 'LORRY'],
    ['double cab', 'PICKUP'],
    ['heavy machinery', 'HEAVY_MACHINERY'],
    ['motorcycle', 'BIKE'],
  ])('maps %s', (input, expected) => {
    expect(coerceVehicleType(input)).toBe(expected);
  });

  it('round-trips all 11 canonical values', () => {
    // The entity union, the vehicles_vehicle_type_check constraint and this
    // table must agree; migration 20000 names the places that drift.
    for (const type of VEHICLE_TYPES) {
      expect(coerceVehicleType(type)).toBe(type);
    }
  });

  it('covers the four types marketplace-service\'s DTO still omits', () => {
    // CreateListingDto declares only 6 values — migration 20000 widened the
    // CHECK constraint and the entity without widening that DTO. The entity is
    // authoritative, so bulk rows may carry these.
    expect(VEHICLE_TYPES).toEqual(
      expect.arrayContaining(['THREE_WHEELER', 'LORRY', 'TRACTOR', 'HEAVY_MACHINERY']),
    );
  });
});
