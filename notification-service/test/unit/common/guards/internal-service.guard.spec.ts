import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServiceGuard } from './internal-service.guard';

function context(headerValue: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === 'x-internal-service-key' ? headerValue : undefined,
      }),
    }),
  } as ExecutionContext;
}

function guard(expected?: string) {
  return new InternalServiceGuard({
    get: (key: string) => (key === 'INTERNAL_SERVICE_KEY' ? expected : undefined),
  } as ConfigService);
}

describe('InternalServiceGuard', () => {
  const key = 'replace-with-a-long-random-internal-service-key';

  it('rejects when INTERNAL_SERVICE_KEY is not configured', () => {
    expect(() => guard(undefined).canActivate(context(key))).toThrow(
      new UnauthorizedException('Internal service key is not configured'),
    );
  });

  it('rejects a missing or wrong key', () => {
    expect(() => guard(key).canActivate(context(undefined))).toThrow(UnauthorizedException);
    expect(() => guard(key).canActivate(context('wrong-key'))).toThrow(UnauthorizedException);
  });

  it('allows a matching X-Internal-Service-Key', () => {
    expect(guard(key).canActivate(context(key))).toBe(true);
  });
});
