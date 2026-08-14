import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';
import {
  AccessTokenPayload,
  getAccessTokenVerifyOptions,
  getJwtAudience,
  getJwtIssuer,
} from '../config/jwt.config';
import type { AuthenticatedUser, UserRole } from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(AuthUserView)
    private readonly users: Repository<AuthUserView>,
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
    const user = await this.users.findOne({ where: { id: payload.sub } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    if (user.role !== 'ADMIN' && !user.emailVerifiedAt) {
      throw new UnauthorizedException('Please verify your email address before signing in.');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
    };
  }
}
