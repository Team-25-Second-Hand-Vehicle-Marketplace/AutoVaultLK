import { UnauthorizedException } from '@nestjs/common';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard();

  it('maps expired tokens to a clear 401 message', () => {
    expect(() =>
      guard.handleRequest(null, null, new TokenExpiredError('jwt expired', new Date())),
    ).toThrow(new UnauthorizedException('Access token has expired'));
  });

  it('maps invalid tokens to a clear 401 message', () => {
    expect(() =>
      guard.handleRequest(null, null, new JsonWebTokenError('invalid token')),
    ).toThrow(new UnauthorizedException('Invalid access token'));
  });

  it('requires an authenticated user', () => {
    expect(() => guard.handleRequest(null, null, undefined)).toThrow(
      new UnauthorizedException('Authentication required'),
    );
  });

  it('returns the authenticated user', () => {
    const user = { id: 'a1', email: 'admin@test.com', role: 'ADMIN' };
    expect(guard.handleRequest(null, user, undefined)).toBe(user);
  });
});
