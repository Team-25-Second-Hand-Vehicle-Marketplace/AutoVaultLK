import { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../src/modules/auth/types/authenticated-user.type';

// createParamDecorator wraps the factory in framework machinery that's
// awkward to invoke directly in a unit test; ROUTE_ARGS_METADATA is how
// Nest itself recovers the raw factory function at runtime, so reading it
// back the same way exercises the real factory logic — request.user — with
// no HTTP server involved.
import { CurrentUser } from '../../../../src/modules/auth/decorators/current-user.decorator';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

function getFactory(): (data: unknown, ctx: ExecutionContext) => AuthenticatedUser {
  class TestController {
    handler(@CurrentUser() _user: AuthenticatedUser) {}
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler');
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

function createContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as ExecutionContext;
}

describe('CurrentUser decorator', () => {
  it('extracts request.user set by the JWT strategy', () => {
    const user: AuthenticatedUser = { id: 'd1', email: 'dealer@test.com', role: 'DEALER' };
    const factory = getFactory();

    expect(factory(undefined, createContext(user))).toBe(user);
  });
});
