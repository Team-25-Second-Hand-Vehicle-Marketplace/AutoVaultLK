import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../../common/validation/normalize-email.decorator';
import {
  PERSON_NAME_MAX,
  PERSON_NAME_MIN,
} from '../../../common/validation/validation.constants';

/** Profile updates only — role, isActive, and passwordHash are never accepted. */
export class UpdateUserDto {
  @IsOptional()
  @NormalizeEmail()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(PERSON_NAME_MIN)
  @MaxLength(PERSON_NAME_MAX)
  name?: string;
}
