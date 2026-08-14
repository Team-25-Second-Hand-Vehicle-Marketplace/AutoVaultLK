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
    if (
      shouldUseRefreshCookies(this.configService) &&
      typeof payload.refreshToken === 'string'
    ) {
      this.setRefreshCookie(response, payload.refreshToken);
      this.setCsrfCookie(response);
    }

    if (
      shouldUseRefreshCookies(this.configService) &&
      !shouldIncludeRefreshTokenInBody(this.configService) &&
      'refreshToken' in payload
    ) {
      const { refreshToken: _refreshToken, ...safePayload } = payload;
      return safePayload;
    }

    return payload;
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

  private setCsrfCookie(response: Response) {
    response.cookie(CSRF_TOKEN_COOKIE_NAME, randomBytes(32).toString('base64url'), {
      ...this.getBaseCookieOptions(),
      httpOnly: false,
      maxAge: this.getRefreshCookieMaxAgeMs(),
    });
  }

  private getBaseCookieOptions() {
    return {
      secure: shouldUseSecureCookies(this.configService),
      sameSite: 'lax' as const,
      path: '/auth',
    };
  }

  private getRefreshCookieMaxAgeMs() {
    return parseDurationToMs(
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    );
  }
}
