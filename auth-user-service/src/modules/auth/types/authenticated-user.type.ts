import { UserRole } from '../../../infrastructure/database/entities/user.entity';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};
