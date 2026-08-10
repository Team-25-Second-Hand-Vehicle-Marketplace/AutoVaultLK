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
    const refreshBody = request.body?.refreshToken;

    if (!refreshCookie || refreshBody) {
      return true;
    }

    const csrfHeader = request.header('x-csrf-token');
    const csrfCookie = request.cookies?.[CSRF_TOKEN_COOKIE_NAME];

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }
}
