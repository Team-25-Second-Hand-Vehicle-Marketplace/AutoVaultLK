import { useCallback, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/useAuth'

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

const SAVED_CHANGED_EVENT = 'autovault:saved-changed'

const EMPTY: string[] = []


const snapshotCache = new Map<string, { raw: string | null; parsed: string[] }>()

function readCached(userId: string): string[] {
  let raw: string | null
  try {
    raw = localStorage.getItem(storageKey(userId))
  } catch {
    return EMPTY
  }

  const cached = snapshotCache.get(userId)
  if (cached && cached.raw === raw) return cached.parsed

  const parsed = read(userId)
  snapshotCache.set(userId, { raw, parsed })
  return parsed
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(SAVED_CHANGED_EVENT, onChange)
  // Fired by other tabs, keeping this one current.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(SAVED_CHANGED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useSavedVehicles() {
  const { user } = useAuth()
  const userId = user?.id ?? null

 
  const savedIds = useSyncExternalStore(
    subscribe,
    () => (userId ? readCached(userId) : EMPTY),
    () => EMPTY,
  )

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
