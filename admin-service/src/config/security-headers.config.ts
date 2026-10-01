import type { HelmetOptions } from 'helmet';

/**
 * Mirrors auth-user-service's helmet() call (configure-http-security.ts).
 * contentSecurityPolicy stays off here too, but for a different reason than
 * "not decided yet": this is a pure JSON API with no HTML views, so a CSP has
 * no document to constrain - it would be a no-op header, not real hardening.
 * Real CSP belongs on the CloudFront-served frontend, not this service.
 */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
};
