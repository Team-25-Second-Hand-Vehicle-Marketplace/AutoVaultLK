import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  CSRF_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  parseDurationToMs,
  shouldIncludeRefreshTokenInBody,
  shouldUseRefreshCookies,
  shouldUseSecureCookies,
} from '../../config/http-security.config';

type TokenResponse = {
  accessToken?: string;
  refreshToken?: string;
  [key: string]: unknown;
};

@Injectable()
export class RefreshTokenCookieService {
  constructor(private readonly configService: ConfigService) {}

  extractRefreshToken(request: { cookies?: Record<string, string> }, bodyToken?: string) {
    const cookieToken = request.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    return cookieToken ?? bodyToken ?? null;
  }

  attachCookies(response: Response, payload: TokenResponse) {
    let body = payload;

    if (
      shouldUseRefreshCookies(this.configService) &&
      typeof payload.refreshToken === 'string'
    ) {
      this.setRefreshCookie(response, payload.refreshToken);
      // Also returned in the body: the SPA runs on a different site from this
      // API, so it cannot read this cookie and must echo the value from here.
      body = { ...payload, csrfToken: this.setCsrfCookie(response) };
    }

    if (
      shouldUseRefreshCookies(this.configService) &&
      !shouldIncludeRefreshTokenInBody(this.configService) &&
      'refreshToken' in body
    ) {
      const { refreshToken: _refreshToken, ...safePayload } = body;
      return safePayload;
    }

    return body;
  }

  clearAuthCookies(response: Response) {
    const baseOptions = this.getBaseCookieOptions();
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, baseOptions);
    response.clearCookie(CSRF_TOKEN_COOKIE_NAME, {
      ...baseOptions,
      httpOnly: false,
    });
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
      ...this.getBaseCookieOptions(),
      httpOnly: true,
      maxAge: this.getRefreshCookieMaxAgeMs(),
    });
  }

  private setCsrfCookie(response: Response): string {
    const csrfToken = randomBytes(32).toString('base64url');
    response.cookie(CSRF_TOKEN_COOKIE_NAME, csrfToken, {
      ...this.getBaseCookieOptions(),
      httpOnly: false,
      maxAge: this.getRefreshCookieMaxAgeMs(),
    });
    return csrfToken;
  }

  private getBaseCookieOptions() {
    // The SPA (CloudFront) and this API (API Gateway) are different origins
    // in every deployed environment, so the refresh/CSRF cookies must be
    // sent cross-site - that requires SameSite=None, which browsers only
    // honor alongside Secure. Locally the Vite dev proxy makes everything
    // same-origin over plain http, where Secure would just break the
    // cookie, so the two attributes are tied together: whichever mode
    // shouldUseSecureCookies() picks is the mode that actually works for
    // that environment's origin setup.
    const secure = shouldUseSecureCookies(this.configService);
    return {
      secure,
      sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
      path: '/auth',
    };
  }

  private getRefreshCookieMaxAgeMs() {
    return parseDurationToMs(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
  }
}
