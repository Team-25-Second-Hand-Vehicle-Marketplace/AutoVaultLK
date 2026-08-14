import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/password.decorator';

export class PasswordResetConfirmDto {
  @IsString()
  @IsNotEmpty({ message: 'token must not be empty' })
  @MinLength(20, { message: 'token is invalid' })
  token!: string;

  @IsString()
  @IsStrongPassword()
  newPassword!: string;
}
