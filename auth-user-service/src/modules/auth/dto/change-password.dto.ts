import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/password.decorator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'currentPassword must not be empty' })
  currentPassword!: string;

  @IsString()
  @IsStrongPassword()
  newPassword!: string;
}
