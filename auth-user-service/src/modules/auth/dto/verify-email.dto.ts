import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'token must not be empty' })
  @MinLength(20, { message: 'token is invalid' })
  token!: string;
}
