import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateListingDto } from '../../../../src/modules/listings/dto/create-listing.dto';
import { UpdateListingDto } from '../../../../src/modules/listings/dto/update-listing.dto';

function validateCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateListingDto, body);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
}

const VALID_LISTING = {
  make: 'Toyota',
  model: 'Aqua',
  manufactureYear: 2018,
  price: 6_500_000,
  mileage: 45_000,
  fuelType: 'HYBRID',
  transmissionType: 'AUTOMATIC',
};

describe('CreateListingDto', () => {
  it('accepts a minimal valid payload', () => {
    expect(validateCreate(VALID_LISTING)).toHaveLength(0);
  });

  it('accepts (but does not require) a client-supplied dealerId — the service ignores it anyway', () => {
    expect(
      validateCreate({ ...VALID_LISTING, dealerId: '11111111-1111-4111-8111-111111111111' }),
    ).toHaveLength(0);
  });

  it('requires make, model, manufactureYear, price, mileage, fuelType, and transmissionType', () => {
    const errors = validateCreate({});
    const properties = errors.map((e) => e.property);
    expect(properties).toEqual(
      expect.arrayContaining([
        'make',
        'model',
        'manufactureYear',
        'price',
        'mileage',
        'fuelType',
        'transmissionType',
      ]),
    );
  });

  it('rejects a manufactureYear before 1980', () => {
    const errors = validateCreate({ ...VALID_LISTING, manufactureYear: 1975 });
    expect(errors.some((e) => e.property === 'manufactureYear')).toBe(true);
  });

  it('rejects a manufactureYear more than one year in the future', () => {
    const errors = validateCreate({
      ...VALID_LISTING,
      manufactureYear: new Date().getFullYear() + 2,
    });
    expect(errors.some((e) => e.property === 'manufactureYear')).toBe(true);
  });

  it('rejects a non-positive price', () => {
    const errors = validateCreate({ ...VALID_LISTING, price: 0 });
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });

  it('rejects a negative mileage', () => {
    const errors = validateCreate({ ...VALID_LISTING, mileage: -1 });
    expect(errors.some((e) => e.property === 'mileage')).toBe(true);
  });

  it('rejects an unknown fuelType not in the enum', () => {
    const errors = validateCreate({ ...VALID_LISTING, fuelType: 'STEAM' });
    expect(errors.some((e) => e.property === 'fuelType')).toBe(true);
  });

  it('rejects an unknown field (whitelist:true, forbidNonWhitelisted:true)', () => {
    const errors = validateCreate({ ...VALID_LISTING, notARealField: 'x' });
    expect(errors.some((e) => e.property === 'notARealField')).toBe(true);
  });
});

describe('UpdateListingDto', () => {
  function validateUpdate(body: Record<string, unknown>) {
    const dto = plainToInstance(UpdateListingDto, body);
    return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  }

  it('accepts an empty body — every inherited field becomes optional via PartialType', () => {
    expect(validateUpdate({})).toHaveLength(0);
  });

  it('accepts a single-field patch', () => {
    expect(validateUpdate({ price: 6_000_000 })).toHaveLength(0);
  });

  it('rejects status — OmitType strips it, so the manual/ETL status split cannot be bypassed via PATCH', () => {
    const errors = validateUpdate({ status: 'LIVE' });
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
