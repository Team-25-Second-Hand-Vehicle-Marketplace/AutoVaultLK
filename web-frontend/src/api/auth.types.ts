/**
 * Mirrors auth-user-service's actual contract as of this branch.
 *
 * Only the endpoints that exist today are modelled here: register (buyer and
 * dealer), login, refresh, and logout. Password reset and email verification
 * are in flight on other branches (feat/AUS-password-reset,
 * feat/AUS-emailverification) and are deliberately NOT stubbed — an inert
 * "Forgot password?" that posts nowhere is worse than its absence.
 *
 * When those land, the response envelope below is unchanged
 * ({ accessToken, refreshToken, user }); registration may additionally start
 * returning { message } instead of tokens when email verification is
 * required, which is why registerBuyer's caller treats a token-less response
 * as "check your email" rather than a failure.
 */

export type UserRole = 'BUYER' | 'DEALER' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

/** Success shape of POST /auth/login and /auth/register/*. */
export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Registration may resolve either way once email verification ships: tokens
 * (log the user straight in) or a message (await verification).
 */
export type RegisterResponse = AuthTokenResponse | { message: string };

export function isTokenResponse(value: RegisterResponse): value is AuthTokenResponse {
  return 'accessToken' in value;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterBuyerRequest {
  email: string;
  password: string;
  name: string;
}

/**
 * POST /auth/register/dealer.
 *
 * Mirrors RegisterDealerDto exactly. Note what is NOT here: the design
 * reference's registration wizard collects a VAT number and a postcode, and
 * `auth.dealer_profiles` has no column for either — collecting them would
 * silently discard whatever the dealer typed, so those fields are not
 * offered.
 *
 * `verificationDocuments` is a required JSONB column with no upload endpoint
 * in this project, so the form sends an empty object; the dealer stays
 * PENDING until an admin reviews them, which is what the real flow does too.
 */
export interface RegisterDealerRequest {
  email: string;
  password: string;
  name: string;
  dealerType: 'individual' | 'business';
  businessRegistrationNumber: string;
  businessAddress: string;
  city: string;
  companyName: string;
  contactNumber: string;
  verificationDocuments: Record<string, unknown>;
}

/**
 * The JWT payload issued by AuthService.issueTokenPair. Only used to read
 * expiry for proactive refresh — never trusted for authorization decisions,
 * which the backend makes on every request.
 */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}
