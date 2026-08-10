import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterBuyerDto } from '../../src/modules/auth/dto/register-buyer.dto';
import { RegisterDealerDto } from '../../src/modules/auth/dto/register-dealer.dto';
import { LoginDto } from '../../src/modules/auth/dto/login.dto';
import { DealerType } from '../../src/infrastructure/database/entities/dealer-profile.entity';
import { CreateUserDto } from '../../src/modules/users/dto/create-user.dto';
import { UpdateUserDto } from '../../src/modules/users/dto/update-user.dto';

async function validateDto<T extends object>(cls: new () => T, plain: object) {
  const instance = plainToInstance(cls, plain);
  return validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('Auth DTO validation', () => {
  it('normalizes email on login', async () => {
    const errors = await validateDto(LoginDto, {
      email: '  Buyer@Test.COM ',
      password: 'secret',
    });

    expect(errors).toHaveLength(0);
    const dto = plainToInstance(LoginDto, {
      email: '  Buyer@Test.COM ',
      password: 'secret',
    });
    expect(dto.email).toBe('buyer@test.com');
  });

  it('rejects weak passwords on buyer registration', async () => {
    const errors = await validateDto(RegisterBuyerDto, {
      email: 'buyer@test.com',
      password: 'weak',
      name: 'Buyer Name',
    });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('accepts a strong password on buyer registration', async () => {
    const errors = await validateDto(RegisterBuyerDto, {
      email: 'buyer@test.com',
      password: 'Str0ngPass',
      name: 'Buyer Name',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects privileged fields on buyer registration', async () => {
    const errors = await validateDto(RegisterBuyerDto, {
      email: 'buyer@test.com',
      password: 'Str0ngPass',
      name: 'Buyer Name',
      role: 'ADMIN',
      isActive: true,
      passwordHash: 'hack',
    });

    expect(errors.some((e) => e.property === 'role')).toBe(true);
    expect(errors.some((e) => e.property === 'isActive')).toBe(true);
    expect(errors.some((e) => e.property === 'passwordHash')).toBe(true);
  });

  it('requires business registration number for business dealers only', async () => {
    const individualErrors = await validateDto(RegisterDealerDto, {
      email: 'dealer@test.com',
      password: 'Str0ngPass',
      name: 'Dealer Name',
      dealerType: DealerType.INDIVIDUAL,
      businessAddress: '123 Main Street',
      city: 'Colombo',
      verificationDocuments: { nic: 's3://doc' },
      companyName: 'Solo Motors',
    });
    expect(individualErrors).toHaveLength(0);

    const businessErrors = await validateDto(RegisterDealerDto, {
      email: 'dealer@test.com',
      password: 'Str0ngPass',
      name: 'Dealer Name',
      dealerType: DealerType.BUSINESS,
      businessAddress: '123 Main Street',
      city: 'Colombo',
      verificationDocuments: { cert: 's3://doc' },
      companyName: 'Biz Motors',
    });
    expect(
      businessErrors.some((e) => e.property === 'businessRegistrationNumber'),
    ).toBe(true);
  });

  it('rejects privileged fields on user create', async () => {
    const errors = await validateDto(CreateUserDto, {
      email: 'user@test.com',
      password: 'Str0ngPass',
      name: 'User Name',
      role: 'ADMIN',
      passwordHash: 'hack',
    });

    expect(errors.some((e) => e.property === 'role')).toBe(true);
    expect(errors.some((e) => e.property === 'passwordHash')).toBe(true);
  });

  it('rejects passwordHash and role on user update', async () => {
    const errors = await validateDto(UpdateUserDto, {
      name: 'New Name',
      role: 'ADMIN',
      isActive: false,
      passwordHash: 'hack',
    });

    expect(errors.some((e) => e.property === 'role')).toBe(true);
    expect(errors.some((e) => e.property === 'isActive')).toBe(true);
    expect(errors.some((e) => e.property === 'passwordHash')).toBe(true);
  });
});
