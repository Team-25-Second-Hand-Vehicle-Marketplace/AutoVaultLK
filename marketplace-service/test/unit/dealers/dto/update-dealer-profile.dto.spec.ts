import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateDealerProfileDto } from '../../../../src/modules/dealers/dto/update-dealer-profile.dto';

function validate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateDealerProfileDto, body);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateDealerProfileDto', () => {
  it('accepts an empty body — every field is optional', () => {
    expect(validate({})).toHaveLength(0);
  });

  it('accepts a full valid payload', () => {
    expect(
      validate({
        businessName: 'Acme Motors',
        ownerName: 'Jane Doe',
        email: 'jane@acme.test',
        phone: '+94771234567',
        address: '123 Galle Road',
        city: 'Colombo',
        province: 'Western',
        profileImage: 'https://example.com/logo.png',
      }),
    ).toHaveLength(0);
  });

  it('rejects a businessName shorter than 3 characters', () => {
    const errors = validate({ businessName: 'ab' });
    expect(errors.some((e) => e.property === 'businessName')).toBe(true);
  });

  it('rejects an invalid email', () => {
    const errors = validate({ email: 'not-an-email' });
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects an invalid phone number', () => {
    const errors = validate({ phone: '123' });
    expect(errors.some((e) => e.property === 'phone')).toBe(true);
  });

  it('rejects an unknown field (whitelist:true, forbidNonWhitelisted:true, matching main.ts)', () => {
    const errors = validate({ businessName: 'Acme', dealerId: 'someone-elses-id' });
    expect(errors.some((e) => e.property === 'dealerId')).toBe(true);
  });
});
