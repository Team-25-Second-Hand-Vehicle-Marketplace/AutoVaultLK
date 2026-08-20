import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /admin/users — FR-12's "or an authenticated Administrator"
 * provisioning path. There is no public registration route for ADMIN.
 *
 * The password rules mirror FR-06 as enforced at registration. Validating
 * here as well as in auth-user-service means a malformed request fails before
 * it crosses a service boundary, and the caller gets a field-level message
 * instead of a relayed 400.
 */
export class CreateAdminDto {
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
