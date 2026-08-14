import { ConfigService } from '@nestjs/config';

export const REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
export const CSRF_TOKEN_COOKIE_NAME = 'csrf_token';

export function parseAllowedOrigins(value?: string): string[] {
  if (!value?.trim()) {
    return ['http://localhost:5173'];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseBooleanConfig(
  value: unknown,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return defaultValue;
}

export function isProductionEnvironment() {
  return process.env.NODE_ENV === 'production';
}

export function shouldUseSecureCookies(configService: ConfigService) {
  if (parseBooleanConfig(configService.get('COOKIE_SECURE'), false)) {
    return true;
  }

  return isProductionEnvironment();
}

export function shouldIncludeRefreshTokenInBody(configService: ConfigService) {
  return parseBooleanConfig(
    configService.get('AUTH_REFRESH_TOKEN_IN_BODY'),
    false,
  );
}

export function shouldUseRefreshCookies(configService: ConfigService) {
  return parseBooleanConfig(
    configService.get('AUTH_USE_REFRESH_COOKIES'),
    true,
  );
}

export function getHttpJsonBodyLimit(configService: ConfigService) {
  return configService.get<string>('HTTP_JSON_BODY_LIMIT', '100kb');
}

export function parseDurationToMs(value: string) {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error('Invalid token duration configuration');
  }

  const amount = Number(match[1]);
  const multipliers = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[match[2] as keyof typeof multipliers];
}
