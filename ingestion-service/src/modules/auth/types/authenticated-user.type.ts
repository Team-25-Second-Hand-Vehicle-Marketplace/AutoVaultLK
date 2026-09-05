export type UserRole = 'BUYER' | 'DEALER' | 'ADMIN';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};
