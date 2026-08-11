import type { Request } from 'express';

export type UserRole = 'BUYER' | 'DEALER' | 'ADMIN';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  email?: string;
}

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  email?: string;
}

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};
