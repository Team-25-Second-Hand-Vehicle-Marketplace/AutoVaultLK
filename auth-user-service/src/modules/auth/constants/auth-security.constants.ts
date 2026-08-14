export const SecurityEventType = {
  LOGIN: 'LOGIN',
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  REGISTER_BUYER: 'REGISTER_BUYER',
  REGISTER_DEALER: 'REGISTER_DEALER',
  REFRESH: 'REFRESH',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

export type SecurityEventType =
  (typeof SecurityEventType)[keyof typeof SecurityEventType];

export const AUTH_SECURITY_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid email or password',
  TOO_MANY_ATTEMPTS:
    'Too many failed attempts. Please try again later.',
  REGISTRATION_RECEIVED:
    'If this email is eligible for registration, you may proceed using the instructions sent to your inbox.',
  PASSWORD_RESET_RECEIVED:
    'If an account with that email exists, password reset instructions will be sent.',
  INVALID_REFRESH_TOKEN: 'Invalid or expired refresh token',
} as const;
