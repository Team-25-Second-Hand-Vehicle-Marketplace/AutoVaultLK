import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class GoogleLoginDto {
  /** The credential Google Identity Services hands the frontend directly — a signed JWT, verified server-side, never trusted as-is. */
  @IsString()
  @IsNotEmpty({ message: 'idToken must not be empty' })
  idToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'deviceLabel must be at most 100 characters' })
  deviceLabel?: string;
}
