import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body for POST /internal/users/admin — FR-12's administrator-provisions-
 * administrator path, called by admin-service.
 *
 * `adminId` identifies the acting administrator, matching the other internal
 * DTOs; the guard proves the caller is a service, this proves which human
 * authorised it.
 */
export class CreateAdminUserDto {
  @IsUUID('4', { message: 'adminId must be a valid UUID' })
  adminId!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/[0-9]/, { message: 'password must contain a number' })
  password!: string;
}
