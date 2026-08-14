import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersRepository } from '../../users/repositories/users.repository';
import {
  AccessTokenPayload,
  getAccessTokenVerifyOptions,
  getJwtAudience,
  getJwtIssuer,
} from '../config/jwt.config';
import { AUTH_SECURITY_MESSAGES } from '../constants/auth-security.constants';
import { AuthenticatedUser } from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersRepository: UsersRepository,
  ) {
    const verify = getAccessTokenVerifyOptions(configService);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: verify.secret as string,
      issuer: getJwtIssuer(configService),
      audience: getJwtAudience(configService),
      algorithms: verify.algorithms,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.usersRepository.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    if (user.role !== 'ADMIN' && !user.emailVerifiedAt) {
      throw new UnauthorizedException(AUTH_SECURITY_MESSAGES.EMAIL_NOT_VERIFIED);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
