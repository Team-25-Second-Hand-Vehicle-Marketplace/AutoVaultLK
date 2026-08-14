import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/normalize-email.decorator';
import { IsStrongPassword } from '../../../common/validation/password.decorator';
import {
  PERSON_NAME_MAX,
  PERSON_NAME_MIN,
} from '../../../common/validation/validation.constants';

/** Safe user creation — no role, isActive, or passwordHash from clients. */
export class CreateUserDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsString()
  @MinLength(PERSON_NAME_MIN)
  @MaxLength(PERSON_NAME_MAX)
  name!: string;
}
