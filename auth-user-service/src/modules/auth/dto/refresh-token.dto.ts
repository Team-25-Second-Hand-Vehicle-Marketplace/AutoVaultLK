import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'refreshToken must not be empty' })
  @MinLength(20, { message: 'refreshToken is invalid' })
  refreshToken!: string;
}
