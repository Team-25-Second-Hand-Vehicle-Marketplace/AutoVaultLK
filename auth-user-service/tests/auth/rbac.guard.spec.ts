import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Roles } from '../../src/modules/auth/decorators/roles.decorator';
import {
  RESOURCE_OWNER_KEY,
  ResourceOwner,
} from '../../src/modules/auth/decorators/resource-owner.decorator';
import { ResourceOwnerGuard } from '../../src/modules/auth/guards/resource-owner.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { AuthenticatedUser } from '../../src/modules/auth/types/authenticated-user.type';

function createContext(
  user: AuthenticatedUser | undefined,
  params: Record<string, string> = {},
  handlerMetadata: Record<string, unknown> = {},
): ExecutionContext {
  const handler = Object.assign(() => undefined, handlerMetadata);

  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
  } as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('allows access when no roles are required', () => {
    const context = createContext({ id: '1', email: 'a@test.com', role: 'BUYER' });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows users with a required role', () => {
    const handler = Roles('ADMIN');
    const context = createContext(
      { id: '1', email: 'admin@test.com', role: 'ADMIN' },
      {},
      { [ROLES_KEY]: reflector.get(ROLES_KEY, handler) },
    );

    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies users without a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const context = createContext({
      id: '1',
      email: 'buyer@test.com',
      role: 'BUYER',
    });

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('Insufficient permissions for this action'),
    );
  });
});

describe('ResourceOwnerGuard', () => {
  const reflector = new Reflector();
  const guard = new ResourceOwnerGuard(reflector);

  it('allows admins to access any resource', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('id');
    const context = createContext(
      { id: 'admin-id', email: 'admin@test.com', role: 'ADMIN' },
      { id: 'other-id' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows owners to access their own resource', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('id');
    const context = createContext(
      { id: 'user-id', email: 'user@test.com', role: 'BUYER' },
      { id: 'user-id' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies non-admins from accessing another users resource', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('userId');
    const context = createContext(
      { id: 'dealer-id', email: 'dealer@test.com', role: 'DEALER' },
      { userId: 'other-dealer-id' },
    );

    expect(() => guard.canActivate(context)).toThrow(
      new ForbiddenException('You can only access your own resources'),
    );
  });

  it('passes through when no resource owner metadata is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createContext(
      { id: 'buyer-id', email: 'buyer@test.com', role: 'BUYER' },
      { id: 'other-id' },
    );

    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('ResourceOwner decorator', () => {
  it('stores the route param name in metadata', () => {
    class TestController {
      @ResourceOwner('userId')
      handler() {}
    }

    const metadata = Reflect.getMetadata(
      RESOURCE_OWNER_KEY,
      TestController.prototype.handler,
    );

    expect(metadata).toBe('userId');
  });
});
