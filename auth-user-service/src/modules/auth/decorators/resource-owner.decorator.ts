import { SetMetadata } from '@nestjs/common';

export const RESOURCE_OWNER_KEY = 'resourceOwner';

/** Route param that must match the authenticated user's id unless the caller is ADMIN. */
export const ResourceOwner = (paramName = 'id') =>
  SetMetadata(RESOURCE_OWNER_KEY, paramName);
