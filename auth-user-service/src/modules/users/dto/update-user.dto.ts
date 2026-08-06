import { UserRole } from '../../../infrastructure/database/entities/user.entity';

export class UpdateUserDto {
  email?: string;
  passwordHash?: string;
  name?: string;
  role?: UserRole;
  isActive?: boolean;
}
