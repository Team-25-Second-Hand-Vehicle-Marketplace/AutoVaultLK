import { apiClient } from './client'
import type {
  DealerProfile,
  ResubmitDealerProfileInput,
  UpdateDealerProfileInput,
} from './dealer.types'

export async function getMyDealerProfile(signal?: AbortSignal): Promise<DealerProfile> {
  const { data } = await apiClient.get<DealerProfile>('/dealer-profiles/me', { signal })
  return data
}

/**
 * PATCH /dealer-profiles/:userId - the backend's ResourceOwnerGuard checks
 * that `userId` is the caller's own id, so this can only ever update the
 * signed-in dealer's own profile.
 */
export async function updateMyDealerProfile(
  userId: string,
  input: UpdateDealerProfileInput,
  signal?: AbortSignal,
): Promise<DealerProfile> {
  const { data } = await apiClient.patch<DealerProfile>(`/dealer-profiles/${userId}`, input, {
    signal,
  })
  return data
}

/**
 * PATCH /dealer-profiles/:userId/resubmit - only for a REJECTED profile (the
 * backend 409s otherwise); on success the profile goes back to PENDING for
 * an admin to review again, and its rejectionReason is cleared.
 */
export async function resubmitMyDealerProfile(
  userId: string,
  input: ResubmitDealerProfileInput,
  signal?: AbortSignal,
): Promise<DealerProfile> {
  const { data } = await apiClient.patch<DealerProfile>(
    `/dealer-profiles/${userId}/resubmit`,
    input,
    { signal },
  )
  return data
}
