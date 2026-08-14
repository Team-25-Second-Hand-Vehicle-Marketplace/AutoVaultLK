import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RESOURCE_OWNER_KEY } from '../decorators/resource-owner.decorator';
import { AuthenticatedUser } from '../types/authenticated-user.type';

@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.getAllAndOverride<string | undefined>(
      RESOURCE_OWNER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!paramName) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      params: Record<string, string>;
    }>();
    const user = request.user;
    const resourceId = request.params[paramName];

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.role === 'ADMIN') {
      return true;
    }

    if (user.id !== resourceId) {
      throw new ForbiddenException('You can only access your own resources');
    }

    return true;
  }
}
