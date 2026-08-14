import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'refreshToken must not be empty' })
  @MinLength(20, { message: 'refreshToken is invalid' })
  refreshToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'deviceLabel must be at most 100 characters' })
  deviceLabel?: string;
}
