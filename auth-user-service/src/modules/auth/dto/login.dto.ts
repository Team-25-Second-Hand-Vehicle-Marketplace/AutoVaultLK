import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/normalize-email.decorator';

export class LoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString()
  @IsNotEmpty({ message: 'email must not be empty' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'password must not be empty' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  password!: string;
}
