import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../../../infrastructure/database/entities/user.entity';
import { UpdateUserDto } from './update-user.dto';

/** Administrator updates for another user's account — not for self-service. */
export class AdminUpdateUserDto extends UpdateUserDto {
  @IsOptional()
  @IsEnum(['BUYER', 'DEALER', 'ADMIN'], {
    message: 'role must be BUYER, DEALER, or ADMIN',
  })
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
