import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/normalize-email.decorator';
import { IsStrongPassword } from '../../../common/validation/password.decorator';
import {
  PERSON_NAME_MAX,
  PERSON_NAME_MIN,
} from '../../../common/validation/validation.constants';

export class RegisterBuyerDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString()
  @IsNotEmpty({ message: 'email must not be empty' })
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsString()
  @MinLength(PERSON_NAME_MIN, {
    message: `name must be at least ${PERSON_NAME_MIN} characters`,
  })
  @MaxLength(PERSON_NAME_MAX, {
    message: `name must be at most ${PERSON_NAME_MAX} characters`,
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'deviceLabel must be at most 100 characters' })
  deviceLabel?: string;
}

// Backward-compatible name for code that still imports RegisterDto.
export { RegisterBuyerDto as RegisterDto };
