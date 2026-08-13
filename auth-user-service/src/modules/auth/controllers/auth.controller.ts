import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterBuyerDto } from '../dto/register-buyer.dto';
import { RegisterDealerDto } from '../dto/register-dealer.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/buyer')
  @HttpCode(HttpStatus.CREATED)
  registerBuyer(@Body() data: RegisterBuyerDto) {
    return this.authService.registerBuyer(data);
  }

  @Post('register/dealer')
  @HttpCode(HttpStatus.CREATED)
  registerDealer(@Body() data: RegisterDealerDto) {
    return this.authService.registerDealer(data);
  }

  @Post('login')
  login(@Body() data: LoginDto) {
    return this.authService.login(data);
  }

  @Post('login/admin')
  loginAdmin(@Body() data: LoginDto) {
    return this.authService.loginAdmin(data);
  }

  @Post('refresh')
  refresh(@Body() data: RefreshTokenDto) {
    return this.authService.refresh(data);
  }

  @Post('logout')
  logout(@Body() data: RefreshTokenDto) {
    return this.authService.logout(data);
  }
}
