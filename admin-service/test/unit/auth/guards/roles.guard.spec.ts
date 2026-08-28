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

  it('returns 403 for a BUYER JWT on ADMIN routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createContext({
      id: 'b1',
      email: 'buyer@test.com',
      role: 'BUYER',
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(
      guard.canActivate(
        createContext({ id: 'd1', email: 'dealer@test.com', role: 'DEALER' }),
      ),
    ).toBe(true);
  });
});
