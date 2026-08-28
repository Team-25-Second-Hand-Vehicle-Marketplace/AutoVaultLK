import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../../../../src/modules/auth/strategies/jwt.strategy';
import type { AccessTokenPayload } from '../../../../src/modules/auth/config/jwt.config';
import type { AuthUserView } from '../../../../src/infrastructure/database/entities/auth-user.view-entity';

describe('JwtStrategy.validate', () => {
  const payload: AccessTokenPayload = {
    sub: 'user-1',
    email: 'user@test.com',
    role: 'DEALER',
  };

  function validate(user: Partial<AuthUserView> | null) {
    const ctx = { users: { findOne: jest.fn().mockResolvedValue(user) } };
    return JwtStrategy.prototype.validate.call(ctx, payload);
  }

  it('rejects when the account does not exist', async () => {
    await expect(validate(null)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an inactive account', async () => {
    await expect(
      validate({ id: 'user-1', isActive: false, role: 'DEALER' }),
    ).rejects.toThrow('User account is inactive or not found');
  });

  it('allows an active ADMIN without email verification', async () => {
    await expect(
      validate({
        id: 'user-1',
        email: 'admin@test.com',
        role: 'ADMIN',
        isActive: true,
        emailVerifiedAt: null,
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'admin@test.com',
      role: 'ADMIN',
    });
  });

  it('rejects an unverified non-admin (e.g. DEALER)', async () => {
    await expect(
      validate({
        id: 'user-1',
        email: 'dealer@test.com',
        role: 'DEALER',
        isActive: true,
        emailVerifiedAt: null,
      }),
    ).rejects.toThrow('Please verify your email address before signing in.');
  });

  it('allows a verified, active non-admin', async () => {
    await expect(
      validate({
        id: 'user-1',
        email: 'dealer@test.com',
        role: 'DEALER',
        isActive: true,
        emailVerifiedAt: new Date('2026-01-01'),
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'dealer@test.com',
      role: 'DEALER',
    });
  });
});
