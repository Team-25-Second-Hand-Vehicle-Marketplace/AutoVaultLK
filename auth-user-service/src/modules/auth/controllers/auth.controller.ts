import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { extractSessionMetadata } from '../utils/session-metadata.util';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterBuyerDto } from '../dto/register-buyer.dto';
import { PasswordResetRequestDto } from '../dto/password-reset-request.dto';
import { RegisterDealerDto } from '../dto/register-dealer.dto';
import { ResendVerificationDto } from '../dto/resend-verification.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/buyer')
  @HttpCode(HttpStatus.CREATED)
  registerBuyer(@Body() data: RegisterBuyerDto, @Req() req: Request) {
    return this.authService.registerBuyer(
      data,
      extractSessionMetadata(req, data.deviceLabel),
    );
  }

  @Post('register/dealer')
  @HttpCode(HttpStatus.CREATED)
  registerDealer(@Body() data: RegisterDealerDto, @Req() req: Request) {
    return this.authService.registerDealer(
      data,
      extractSessionMetadata(req),
    );
  }

  @Post('login')
  login(@Body() data: LoginDto, @Req() req: Request) {
    return this.authService.login(
      data,
      extractSessionMetadata(req, data.deviceLabel),
    );
  }

  @Post('login/admin')
  loginAdmin(@Body() data: LoginDto, @Req() req: Request) {
    return this.authService.loginAdmin(
      data,
      extractSessionMetadata(req, data.deviceLabel),
    );
  }

  @Post('refresh')
  refresh(@Body() data: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(
      data,
      extractSessionMetadata(req, data.deviceLabel),
    );
  }

  @Post('logout')
  logout(@Body() data: RefreshTokenDto) {
    return this.authService.logout(data);
  }

  @Post('logout/all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAllSessions(user.id);
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  requestPasswordReset(
    @Body() data: PasswordResetRequestDto,
    @Req() req: Request,
  ) {
    return this.authService.requestPasswordReset(
      data,
      extractSessionMetadata(req),
    );
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmail(@Body() data: VerifyEmailDto) {
    return this.authService.verifyEmail(data.token);
  }

  @Post('email/resend-verification')
  @HttpCode(HttpStatus.OK)
  resendVerification(@Body() data: ResendVerificationDto, @Req() req: Request) {
    return this.authService.resendVerificationEmail(
      data.email,
      extractSessionMetadata(req),
    );
  }
}
