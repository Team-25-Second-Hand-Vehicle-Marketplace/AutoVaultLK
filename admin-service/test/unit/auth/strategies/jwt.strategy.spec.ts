import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import type { AccessTokenPayload } from '../config/jwt.config';
import type { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';

describe('JwtStrategy.validate', () => {
  const payload: AccessTokenPayload = {
    sub: 'user-1',
    email: 'user@test.com',
    role: 'ADMIN',
  };

  function validate(user: Partial<AuthUserView> | null) {
    const ctx = { users: { findOne: jest.fn().mockResolvedValue(user) } };
    return JwtStrategy.prototype.validate.call(ctx, payload);
  }

  it('rejects a missing or inactive account', async () => {
    await expect(validate(null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(validate({ id: 'user-1', isActive: false, role: 'ADMIN' })).rejects.toThrow(
      'User account is inactive or not found',
    );
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

  it('rejects an unverified non-admin', async () => {
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
});
