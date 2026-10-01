import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  CSRF_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
  parseAllowedOrigins,
  shouldUseRefreshCookies,
} from '../../config/http-security.config';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!shouldUseRefreshCookies(this.configService)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const refreshCookie = request.cookies?.[REFRESH_TOKEN_COOKIE_NAME];

    // No cookie means this request isn't relying on ambient browser
    // credentials in the first place (e.g. a first-time client that only
    // has a body token) - nothing for a forged cross-site request to ride.
    if (!refreshCookie) {
      return true;
    }

    this.assertAllowedOrigin(request);

    const csrfHeader = request.header('x-csrf-token');
    const csrfCookie = request.cookies?.[CSRF_TOKEN_COOKIE_NAME];

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }

  // Defense in depth alongside the double-submit check above: now that the
  // refresh cookie is SameSite=None in every deployed environment (it has to
  // be, since the SPA and this API are different origins), SameSite no
  // longer blocks cross-site requests from carrying it the way a Lax cookie
  // would. A browser always sets Origin on a cross-site fetch/XHR, so a
  // request bearing the cookie from anywhere off the allowlist is rejected
  // outright, before it even reaches the token comparison.
  private assertAllowedOrigin(request: Request) {
    const origin = request.header('origin');
    if (!origin) {
      return;
    }

    const allowedOrigins = parseAllowedOrigins(
      this.configService.get<string>('CORS_ORIGINS'),
    );
    if (!allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
  }
}
