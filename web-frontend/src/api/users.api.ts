import { apiClient } from './client'
import type { AuthUser } from './auth.types'

/**
 * PATCH /users/:id - self-service only (ResourceOwnerGuard: `id` must be the
 * caller's own). Backend's UpdateUserDto accepts `name` and `email`; this
 * only ever sends `name` - email changes are a bigger, separate concern
 * (re-verification) that no UI exposes yet.
 */
export async function updateMyName(
  userId: string,
  name: string,
  signal?: AbortSignal,
): Promise<AuthUser> {
  const { data } = await apiClient.patch<AuthUser>(`/users/${userId}`, { name }, { signal })
  return data
}
