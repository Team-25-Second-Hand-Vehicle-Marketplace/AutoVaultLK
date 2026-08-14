import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/normalize-email.decorator';

export class PasswordResetRequestDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString()
  @IsNotEmpty({ message: 'email must not be empty' })
  email!: string;
}
