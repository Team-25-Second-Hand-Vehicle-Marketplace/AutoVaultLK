import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'

/**
 * Saved-listing ids for the current user.
 *
 * Client-side only. marketplace-service's favourites module is empty on this
 * branch — controllers/, services/, repositories/ contain nothing but
 * .gitkeep — so there is no API to call yet. When feat/MP-favourite merges,
 * this hook is the only file that changes: swap the localStorage reads for
 * GET/POST/DELETE /favourites and everything above it keeps working.
 *
 * Keyed per user id so two accounts on one browser don't share a list, and
 * so signing out doesn't leak the previous user's saves into the next
 * session.
 */
function storageKey(userId: string): string {
  return `autovault.saved.${userId}`
}

function read(userId: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

/**
 * Lets separate SaveButton instances (and the Saved page) stay in sync
 * without a shared provider. The browser only fires the native `storage`
 * event in OTHER tabs, so same-tab updates need this explicit channel.
 */
const SAVED_CHANGED_EVENT = 'autovault:saved-changed'

export function useSavedVehicles() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [savedIds, setSavedIds] = useState<string[]>([])

  useEffect(() => {
    if (!userId) {
      setSavedIds([])
      return
    }

    const sync = () => setSavedIds(read(userId))
    sync()

    window.addEventListener(SAVED_CHANGED_EVENT, sync)
    // Fired by other tabs, keeping this one current.
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [userId])

  const isSaved = useCallback(
    (vehicleId: string) => savedIds.includes(vehicleId),
    [savedIds],
  )

  /** Toggles a listing and returns its new saved state. */
  const toggle = useCallback(
    (vehicleId: string): boolean => {
      if (!userId) return false

      // Re-read rather than deriving from `savedIds`: another component
      // instance may have written since this one last rendered.
      const current = read(userId)
      const nowSaved = !current.includes(vehicleId)
      const next = nowSaved
        ? [...current, vehicleId]
        : current.filter((id) => id !== vehicleId)

      localStorage.setItem(storageKey(userId), JSON.stringify(next))
      window.dispatchEvent(new Event(SAVED_CHANGED_EVENT))
      return nowSaved
    },
    [userId],
  )

  return { savedIds, isSaved, toggle }
}
