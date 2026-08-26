import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../../../src/modules/auth/guards/roles.guard';
import type { AuthenticatedUser } from '../../../../src/modules/auth/types/authenticated-user.type';

function createContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('returns 403 for a BUYER JWT on a DEALER/ADMIN-only route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DEALER', 'ADMIN']);
    const context = createContext({ id: 'b1', email: 'buyer@test.com', role: 'BUYER' });

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Insufficient permissions for this action'),
    );
  });

  it('allows a DEALER JWT on a DEALER/ADMIN-only route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DEALER', 'ADMIN']);
    const context = createContext({ id: 'd1', email: 'dealer@test.com', role: 'DEALER' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an ADMIN JWT on a DEALER/ADMIN-only route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['DEALER', 'ADMIN']);
    const context = createContext({ id: 'a1', email: 'admin@test.com', role: 'ADMIN' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('403s when no user is on the request at all', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    expect(() => guard.canActivate(createContext(undefined))).toThrow(ForbiddenException);
  });

  it('allows access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(
      guard.canActivate(createContext({ id: 'b1', email: 'buyer@test.com', role: 'BUYER' })),
    ).toBe(true);
  });
});
