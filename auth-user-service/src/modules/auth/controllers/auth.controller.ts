import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CsrfGuard } from '../../../common/security/csrf.guard';
import { RefreshTokenCookieService } from '../../../common/security/refresh-token-cookie.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { extractSessionMetadata } from '../utils/session-metadata.util';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { LoginDto } from '../dto/login.dto';
import { PasswordResetConfirmDto } from '../dto/password-reset-confirm.dto';
import { PasswordResetRequestDto } from '../dto/password-reset-request.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { RegisterBuyerDto } from '../dto/register-buyer.dto';
import { RegisterDealerDto } from '../dto/register-dealer.dto';
import { ResendVerificationDto } from '../dto/resend-verification.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';
import { AuthService } from '../services/auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly refreshTokenCookieService: RefreshTokenCookieService,
  ) {}

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
  async login(
    @Body() data: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(
      data,
      extractSessionMetadata(req, data.deviceLabel),
    );
    return this.refreshTokenCookieService.attachCookies(res, result);
  }

  @Post('login/admin')
  async loginAdmin(
    @Body() data: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginAdmin(
      data,
      extractSessionMetadata(req, data.deviceLabel),
    );
    return this.refreshTokenCookieService.attachCookies(res, result);
  }

  @Post('refresh')
  @UseGuards(CsrfGuard)
  async refresh(
    @Body() data: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = this.refreshTokenCookieService.extractRefreshToken(
      req,
      data.refreshToken,
    );
    if (!refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    const result = await this.authService.refresh(
      { ...data, refreshToken },
      extractSessionMetadata(req, data.deviceLabel),
    );
    return this.refreshTokenCookieService.attachCookies(res, result);
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  async logout(
    @Body() data: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = this.refreshTokenCookieService.extractRefreshToken(
      req,
      data.refreshToken,
    );

    const result = refreshToken
      ? await this.authService.logout({ ...data, refreshToken })
      : { success: true };

    this.refreshTokenCookieService.clearAuthCookies(res);
    return result;
  }

  @Post('logout/all')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.refreshTokenCookieService.clearAuthCookies(res);
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

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(
    @Body() data: PasswordResetRequestDto,
    @Req() req: Request,
  ) {
    return this.authService.requestPasswordReset(
      data,
      extractSessionMetadata(req),
    );
  }

  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  confirmPasswordReset(
    @Body() data: PasswordResetConfirmDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.refreshTokenCookieService.clearAuthCookies(res);
    return this.authService.confirmPasswordReset(data);
  }

  @Post('password/change')
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() data: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.refreshTokenCookieService.clearAuthCookies(res);
    return this.authService.changePassword(user.id, data);
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
