import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(
    err: Error | null,
    user: TUser,
    info: Error | undefined,
  ): TUser {
    if (info?.name === 'TokenExpiredError') {
      throw new UnauthorizedException('Access token has expired');
    }

    if (info?.name === 'JsonWebTokenError') {
      throw new UnauthorizedException('Invalid access token');
    }

    if (err || !user) {
      throw err ?? new UnauthorizedException('Authentication required');
    }

    return user;
  }

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
