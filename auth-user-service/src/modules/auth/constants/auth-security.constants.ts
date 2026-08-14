export const SecurityEventType = {
  LOGIN: 'LOGIN',
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  REGISTER_BUYER: 'REGISTER_BUYER',
  REGISTER_DEALER: 'REGISTER_DEALER',
  REFRESH: 'REFRESH',
  PASSWORD_RESET: 'PASSWORD_RESET',
  RESEND_EMAIL_VERIFICATION: 'RESEND_EMAIL_VERIFICATION',
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
  EMAIL_NOT_VERIFIED:
    'Please verify your email address before signing in.',
  INVALID_VERIFICATION_TOKEN: 'Invalid or expired verification token',
  EMAIL_VERIFIED: 'Email address verified successfully.',
  RESEND_VERIFICATION_RECEIVED:
    'If this email is registered and not yet verified, a new verification link will be sent.',
} as const;
