import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CSRF_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from '../../src/config/http-security.config';
import { CsrfGuard } from '../../src/common/security/csrf.guard';
import { RefreshTokenCookieService } from '../../src/common/security/refresh-token-cookie.service';

describe('HTTP security helpers', () => {
  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        AUTH_USE_REFRESH_COOKIES: true,
        AUTH_REFRESH_TOKEN_IN_BODY: false,
        COOKIE_SECURE: false,
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return values[key] ?? defaultValue;
    }),
  };

  const cookieService = new RefreshTokenCookieService(
    configService as unknown as ConfigService,
  );
  const csrfGuard = new CsrfGuard(configService as unknown as ConfigService);

  it('extracts refresh tokens from cookies before body values', () => {
    expect(
      cookieService.extractRefreshToken(
        { cookies: { [REFRESH_TOKEN_COOKIE_NAME]: 'cookie-token-value' } },
        'body-token-value',
      ),
    ).toBe('cookie-token-value');
  });

  it('omits refresh tokens from JSON when cookie transport is enabled', () => {
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    const payload = cookieService.attachCookies(response as never, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token-value-1234567890',
      user: { id: 'user-id' },
    });

    expect(payload).toEqual({
      accessToken: 'access-token',
      user: { id: 'user-id' },
    });
    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'refresh-token-value-1234567890',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/auth',
      }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      CSRF_TOKEN_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({
        httpOnly: false,
        path: '/auth',
      }),
    );
  });

  it('requires a matching CSRF token for cookie-based refresh requests', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: {
            [REFRESH_TOKEN_COOKIE_NAME]: 'refresh-token',
            [CSRF_TOKEN_COOKIE_NAME]: 'csrf-token',
          },
          body: {},
          header: (name: string) =>
            name === 'x-csrf-token' ? 'wrong-token' : undefined,
        }),
      }),
    };

    expect(() => csrfGuard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
  });

  it('skips CSRF checks when refresh tokens are sent in the request body', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          cookies: {
            [REFRESH_TOKEN_COOKIE_NAME]: 'refresh-token',
          },
          body: {
            refreshToken: 'body-token-value-1234567890',
          },
          header: () => undefined,
        }),
      }),
    };

    expect(csrfGuard.canActivate(context as never)).toBe(true);
  });
});
