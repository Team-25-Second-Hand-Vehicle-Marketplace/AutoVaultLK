import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { FilterSearchDto } from '../../../../src/modules/search/dto/filter-search.dto';

/**
 * The DTO is the security boundary: NestJS's global ValidationPipe runs these
 * decorators before any controller body executes, and anything not declared
 * here is rejected outright.
 *
 * These tests exercise it exactly as the pipe does — plainToInstance with
 * transform semantics, then validateSync — so a decorator that silently stops
 * working (the `specs` whitelist interaction documented in the DTO is a real
 * instance of that) fails here rather than in production.
 */

/** Mirrors the ValidationPipe options registered in main.ts. */
function transform(query: Record<string, unknown>): FilterSearchDto {
  return plainToInstance(FilterSearchDto, query, {
    enableImplicitConversion: false,
  });
}

function validate(query: Record<string, unknown>) {
  const dto = transform(query);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

/** The property names that failed validation. */
const failedProps = (errors: ReturnType<typeof validateSync>) =>
  errors.map((e) => e.property).sort();

describe('FilterSearchDto — array coercion', () => {
  it('accepts a comma-separated list', () => {
    const { dto, errors } = validate({ fuelType: 'PETROL,DIESEL' });

    expect(errors).toHaveLength(0);
    expect(dto.fuelType).toEqual(['PETROL', 'DIESEL']);
  });

  it('accepts a repeated query parameter', () => {
    const { dto, errors } = validate({ fuelType: ['PETROL', 'DIESEL'] });

    expect(errors).toHaveLength(0);
    expect(dto.fuelType).toEqual(['PETROL', 'DIESEL']);
  });

  it('accepts a single value as a one-element array', () => {
    const { dto } = validate({ vehicleType: 'CAR' });

    expect(dto.vehicleType).toEqual(['CAR']);
  });

  it('trims whitespace around comma-separated values', () => {
    const { dto } = validate({ make: 'Toyota , Honda' });

    expect(dto.make).toEqual(['Toyota', 'Honda']);
  });

  it('treats an empty string as absent rather than an empty array', () => {
    const { dto, errors } = validate({ make: '' });

    expect(errors).toHaveLength(0);
    expect(dto.make).toBeUndefined();
  });
});

describe('FilterSearchDto — enum whitelisting', () => {
  it('rejects a vehicle type outside the CHECK constraint', () => {
    const { errors } = validate({ vehicleType: 'SPACESHIP' });

    expect(failedProps(errors)).toEqual(['vehicleType']);
  });

  it('rejects an invalid value mixed in with valid ones', () => {
    const { errors } = validate({ fuelType: 'PETROL,PLUTONIUM' });

    expect(failedProps(errors)).toEqual(['fuelType']);
  });

  it.each(['CAR', 'BIKE', 'VAN', 'TRUCK', 'SUV', 'BUS', 'THREE_WHEELER', 'LORRY', 'PICKUP', 'TRACTOR', 'HEAVY_MACHINERY'])(
    'accepts vehicle type %s',
    (value) => {
      const { errors } = validate({ vehicleType: value });
      expect(errors).toHaveLength(0);
    },
  );

  it.each(['NEW', 'USED', 'RECONDITIONED'])('accepts condition %s', (value) => {
    const { errors } = validate({ condition: value });
    expect(errors).toHaveLength(0);
  });

  it('rejects an unknown sort option', () => {
    const { errors } = validate({ sort: 'price_sideways' });

    expect(failedProps(errors)).toEqual(['sort']);
  });

  it('accepts free-text make and model, which are not closed enums', () => {
    // make/model are validated against the dictionary at search time, not
    // here — a new make must not require a code change to be searchable.
    const { errors } = validate({ make: 'Some New Brand', model: 'Unknown Model' });

    expect(errors).toHaveLength(0);
  });
});

describe('FilterSearchDto — numeric coercion and bounds', () => {
  it('coerces numeric strings from the query string', () => {
    const { dto, errors } = validate({ minPrice: '1000000', maxPrice: '5000000' });

    expect(errors).toHaveLength(0);
    expect(dto.minPrice).toBe(1_000_000);
    expect(typeof dto.minPrice).toBe('number');
  });

  it('rejects a negative price', () => {
    const { errors } = validate({ minPrice: '-1' });

    expect(failedProps(errors)).toEqual(['minPrice']);
  });

  it('rejects a non-numeric price', () => {
    const { errors } = validate({ maxPrice: 'cheap' });

    expect(failedProps(errors)).toEqual(['maxPrice']);
  });

  it('rejects a year below the supported floor', () => {
    const { errors } = validate({ minYear: '1900' });

    expect(failedProps(errors)).toEqual(['minYear']);
  });

  it('rejects a year above the supported ceiling', () => {
    const { errors } = validate({ maxYear: '2200' });

    expect(failedProps(errors)).toEqual(['maxYear']);
  });

  it('caps the page size at the declared maximum', () => {
    const { errors } = validate({ limit: '500' });

    expect(failedProps(errors)).toEqual(['limit']);
  });

  it('rejects page zero', () => {
    const { errors } = validate({ page: '0' });

    expect(failedProps(errors)).toEqual(['page']);
  });

  it('accepts a page size at exactly the maximum', () => {
    const { errors } = validate({ limit: '50' });

    expect(errors).toHaveLength(0);
  });
});

describe('FilterSearchDto — specs parsing', () => {
  it('parses the flat key:value form', () => {
    const { dto, errors } = validate({ specs: 'body_type:SUV,seats:5' });

    expect(errors).toHaveLength(0);
    expect(dto.specs).toEqual([
      { key: 'body_type', value: 'SUV' },
      { key: 'seats', value: '5' },
    ]);
  });

  it('parses a single spec', () => {
    const { dto } = validate({ specs: 'sunroof:true' });

    expect(dto.specs).toEqual([{ key: 'sunroof', value: 'true' }]);
  });

  it('keeps a value containing a colon intact', () => {
    // Only the first colon separates key from value.
    const { dto } = validate({ specs: 'engine_class:250cc+' });

    expect(dto.specs).toEqual([{ key: 'engine_class', value: '250cc+' }]);
  });

  it('throws a 400 on a malformed entry with no colon', () => {
    expect(() => transform({ specs: 'body_type' })).toThrow(BadRequestException);
  });

  it('treats an empty specs string as absent', () => {
    const { dto } = validate({ specs: '' });

    expect(dto.specs).toBeUndefined();
  });

  it('survives the whitelist interaction that broke the nested form', () => {
    // Regression guard for the documented bug: with @ValidateNested, every
    // spec request was rejected as "should not exist" by whitelist:true
    // before reaching the query builder. The flat string form sidesteps the
    // nested property-recognition path entirely.
    const { dto, errors } = validate({ specs: 'body_type:SUV' });

    expect(errors).toHaveLength(0);
    expect(dto.specs).toHaveLength(1);
  });
});

describe('FilterSearchDto — unknown parameters', () => {
  it('rejects a parameter that is not declared', () => {
    const { errors } = validate({ dropTable: 'vehicles' });

    // forbidNonWhitelisted turns an undeclared property into a 400 rather
    // than silently ignoring it.
    expect(failedProps(errors)).toEqual(['dropTable']);
  });

  it('rejects an attempt to filter on status directly', () => {
    // status is never buyer-controllable — every search is gated to LIVE by
    // the query builder, unconditionally.
    const { errors } = validate({ status: 'DRAFT' });

    expect(failedProps(errors)).toEqual(['status']);
  });

  it('rejects an attempt to inject a dealer id filter', () => {
    const { errors } = validate({ dealerId: 'someone-else' });

    expect(failedProps(errors)).toEqual(['dealerId']);
  });
});

describe('FilterSearchDto — realistic query strings', () => {
  it('accepts a fully populated search', () => {
    const { dto, errors } = validate({
      vehicleType: 'CAR,SUV',
      make: 'Toyota',
      fuelType: 'HYBRID',
      transmissionType: 'AUTOMATIC',
      condition: 'USED',
      minPrice: '2000000',
      maxPrice: '8000000',
      minYear: '2015',
      maxYear: '2020',
      maxMileage: '100000',
      specs: 'body_type:SUV,seats:5',
      sort: 'price_asc',
      page: '2',
      limit: '20',
      q: 'hybrid',
    });

    expect(errors).toHaveLength(0);
    expect(dto.vehicleType).toEqual(['CAR', 'SUV']);
    expect(dto.minPrice).toBe(2_000_000);
    expect(dto.specs).toHaveLength(2);
  });

  it('accepts an entirely empty query', () => {
    const { errors } = validate({});

    // "Show me everything" is a valid search — the LIVE gate is applied by
    // the builder regardless.
    expect(errors).toHaveLength(0);
  });
});
