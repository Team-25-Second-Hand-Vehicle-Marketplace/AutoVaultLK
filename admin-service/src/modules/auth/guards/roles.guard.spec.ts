import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../types/authenticated-user.type';

function createContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}

describe('RolesGuard (admin-service)', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('returns 403 for a DEALER JWT on ADMIN routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createContext({
      id: 'd1',
      email: 'dealer@test.com',
      role: 'DEALER',
    });

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Insufficient permissions for this action'),
    );
  });

  it('allows an ADMIN JWT', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createContext({
      id: 'a1',
      email: 'admin@test.com',
      role: 'ADMIN',
    });

    expect(guard.canActivate(context)).toBe(true);
  });
});
