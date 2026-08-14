/** FR-06: minimum 8 characters with mixed case and a digit. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_STRENGTH_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/;

export const PASSWORD_STRENGTH_MESSAGE =
  'Password must be 8–128 characters and include uppercase, lowercase, and a number';

export const PERSON_NAME_MIN = 2;
export const PERSON_NAME_MAX = 255;

export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 255;

/** E.164-style phone numbers (Sri Lanka and international). */
export const PHONE_REGEX = /^\+?[1-9]\d{8,14}$/;

export const PHONE_MESSAGE =
  'Phone number must be 9–15 digits, optionally prefixed with +';
