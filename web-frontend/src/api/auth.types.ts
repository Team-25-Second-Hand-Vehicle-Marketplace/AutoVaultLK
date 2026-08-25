

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
  refreshToken: string;
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
  businessRegistrationNumber: string;
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
