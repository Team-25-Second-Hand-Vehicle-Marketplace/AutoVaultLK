import Joi from 'joi';

const BOOLEAN_KEYS = new Set([
  'AUTH_RETURN_VERIFICATION_TOKEN',
  'AUTH_RETURN_PASSWORD_RESET_TOKEN',
  'COOKIE_SECURE',
  'AUTH_USE_REFRESH_COOKIES',
  'AUTH_REFRESH_TOKEN_IN_BODY',
  'DISABLE_VERBOSE_ERRORS',
]);

const NUMBER_KEYS = new Set([
  'PORT',
  'MAX_ACTIVE_REFRESH_SESSIONS',
  'AUTH_LOGIN_MAX_ATTEMPTS',
  'AUTH_LOGIN_LOCKOUT_MINUTES',
  'AUTH_LOGIN_WINDOW_MINUTES',
  'AUTH_IP_MAX_ATTEMPTS',
  'AUTH_REGISTER_MAX_PER_IP',
  'AUTH_REGISTER_WINDOW_MINUTES',
  'AUTH_REFRESH_MAX_PER_IP',
  'AUTH_REFRESH_WINDOW_MINUTES',
  'AUTH_PASSWORD_RESET_MAX_PER_EMAIL',
  'AUTH_PASSWORD_RESET_WINDOW_MINUTES',
  'AUTH_PROGRESSIVE_DELAY_BASE_MS',
  'AUTH_PROGRESSIVE_DELAY_MAX_MS',
  'EMAIL_VERIFICATION_EXPIRES_HOURS',
  'AUTH_RESEND_VERIFICATION_MAX_PER_EMAIL',
  'AUTH_RESEND_VERIFICATION_WINDOW_MINUTES',
  'PASSWORD_RESET_EXPIRES_MINUTES',
  'PASSWORD_HISTORY_COUNT',
]);

function coerceConfigValue(key: string, value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (BOOLEAN_KEYS.has(key)) {
    return value.toLowerCase() === 'true';
  }

  if (NUMBER_KEYS.has(key)) {
    return Number(value);
  }

  return value;
}

export function buildE2eConfiguration(
  overrides: Record<string, string> = {},
) {
  const raw = { ...process.env, ...overrides };
  const config: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const coerced = coerceConfigValue(key, value);
    if (coerced !== undefined) {
      config[key] = coerced;
    }
  }

  return config;
}

export function buildE2eValidationSchema() {
  return Joi.object({
    PORT: Joi.number().port().default(3000),
    AUTH_DATABASE_URL: Joi.string().uri().required(),
    JWT_ACCESS_SECRET: Joi.string().min(32).required(),
    JWT_ISSUER: Joi.string().min(3).default('autovault-lk-auth'),
    JWT_AUDIENCE: Joi.string().min(3).default('autovault-lk-api'),
    JWT_ALGORITHM: Joi.string().valid('HS256').default('HS256'),
    JWT_ACCESS_EXPIRES_IN: Joi.string()
      .pattern(/^\d+[smhd]$/)
      .default('15m'),
    JWT_REFRESH_EXPIRES_IN: Joi.string()
      .pattern(/^\d+[smhd]$/)
      .default('7d'),
    MAX_ACTIVE_REFRESH_SESSIONS: Joi.number().integer().min(1).max(50).default(5),
    AUTH_LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(5),
    AUTH_LOGIN_LOCKOUT_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
    AUTH_LOGIN_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
    AUTH_IP_MAX_ATTEMPTS: Joi.number().integer().min(1).max(1000).default(20),
    AUTH_REGISTER_MAX_PER_IP: Joi.number().integer().min(1).max(100).default(5),
    AUTH_REGISTER_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(60),
    AUTH_REFRESH_MAX_PER_IP: Joi.number().integer().min(1).max(1000).default(30),
    AUTH_REFRESH_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
    AUTH_PASSWORD_RESET_MAX_PER_EMAIL: Joi.number().integer().min(1).max(50).default(3),
    AUTH_PASSWORD_RESET_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(60),
    AUTH_PROGRESSIVE_DELAY_BASE_MS: Joi.number().integer().min(0).max(5000).default(250),
    AUTH_PROGRESSIVE_DELAY_MAX_MS: Joi.number().integer().min(0).max(30000).default(4000),
    EMAIL_VERIFICATION_EXPIRES_HOURS: Joi.number().integer().min(1).max(168).default(24),
    AUTH_RETURN_VERIFICATION_TOKEN: Joi.boolean().default(false),
    AUTH_RESEND_VERIFICATION_MAX_PER_EMAIL: Joi.number().integer().min(1).max(20).default(3),
    AUTH_RESEND_VERIFICATION_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(60),
    PASSWORD_RESET_EXPIRES_MINUTES: Joi.number().integer().min(5).max(1440).default(60),
    PASSWORD_HISTORY_COUNT: Joi.number().integer().min(1).max(24).default(5),
    AUTH_RETURN_PASSWORD_RESET_TOKEN: Joi.boolean().default(false),
    CORS_ORIGINS: Joi.string().default('http://localhost:5173'),
    COOKIE_SECURE: Joi.boolean().default(false),
    AUTH_USE_REFRESH_COOKIES: Joi.boolean().default(true),
    AUTH_REFRESH_TOKEN_IN_BODY: Joi.boolean().default(false),
    HTTP_JSON_BODY_LIMIT: Joi.string().default('100kb'),
    DISABLE_VERBOSE_ERRORS: Joi.boolean().default(false),
  });
}
