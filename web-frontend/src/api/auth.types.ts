

export type UserRole = 'BUYER' | 'DEALER' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

export interface AuthTokenResponse {
  accessToken: string;
  // Omitted by the server once AUTH_REFRESH_TOKEN_IN_BODY=false (every
  // deployed environment) - the refresh token travels only as an httpOnly
  // cookie the frontend never reads directly.
  refreshToken?: string;
  // Echoed back on login, registration and refresh so the SPA can send it as
  // the x-csrf-token header; it cannot read the API's csrf_token cookie itself.
  csrfToken?: string;
  user: AuthUser;
}


export type RegisterResponse = AuthTokenResponse | { message: string };

export function isTokenResponse(value: RegisterResponse): value is AuthTokenResponse {
  return 'accessToken' in value;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GoogleLoginRequest {
  idToken: string;
}

export interface RegisterBuyerRequest {
  email: string;
  password: string;
  name: string;
}


export interface RegisterDealerRequest {
  email: string;
  password: string;
  name: string;
  dealerType: 'individual' | 'business';
  /** Required by the API only when dealerType is 'business'. */
  businessRegistrationNumber?: string;
  businessAddress: string;
  city: string;
  companyName: string;
  contactNumber: string;
  verificationDocuments: Record<string, unknown>;
}

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}
