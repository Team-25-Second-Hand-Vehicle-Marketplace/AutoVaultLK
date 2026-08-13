import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

const HEADER_NAME = 'x-internal-service-key';

@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>('INTERNAL_SERVICE_KEY');
    if (!expected) {
      throw new UnauthorizedException('Internal service key is not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header(HEADER_NAME);

    if (!provided || !this.secretsMatch(provided, expected)) {
      throw new UnauthorizedException('Invalid internal service key');
    }

    return true;
  }

  private secretsMatch(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
