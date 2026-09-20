import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../auth/useAuth'
import {
  addFavourite,
  getMyFavourites,
  isAlreadyInDesiredState,
  removeFavourite,
} from '../api/favourites.api'

/**
 * The buyer's saved listings, held server-side (FR-16 / FR-17).
 *
 * This used to keep ids in `localStorage`, which meant a buyer lost their saved
 * list whenever they switched device or cleared their browser — while
 * `marketplace.favourites` sat unused. The public shape is unchanged
 * (`savedIds`, `isSaved`, `toggle`) so callers needed almost no edits, but
 * **`toggle` is now async**.
 *
 * Guests get nothing here: `SaveButton` prompts them to sign in (FR-55) rather
 * than saving locally. One source of truth is worth more than an offline
 * convenience that silently disagrees with the server after login.
 */

const CHANGED_EVENT = 'autovault:saved-changed'

const EMPTY: string[] = []

/** userId → their saved vehicle ids. Module-level so every hook instance agrees. */
const store = new Map<string, string[]>()

/** userIds whose list has been fetched (or is being fetched) this session. */
const hydrated = new Set<string>()

function notify(): void {
  window.dispatchEvent(new Event(CHANGED_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange)
  return () => window.removeEventListener(CHANGED_EVENT, onChange)
}

function read(userId: string): string[] {
  return store.get(userId) ?? EMPTY
}

function write(userId: string, ids: string[]): void {
  store.set(userId, ids)
  notify()
}

/**
 * Clears every cached list.
 *
 * Called when the signed-in user changes, so a second buyer on the same browser
 * never sees the first one's saved list between mount and the first fetch. Also
 * the reset seam for tests.
 */
export function __resetSavedVehicles(): void {
  store.clear()
  hydrated.clear()
  notify()
}

/** Whose list the module-level cache currently holds. */
let cachedFor: string | null = null

export function useSavedVehicles() {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const savedIds = useSyncExternalStore(
    subscribe,
    () => (userId ? read(userId) : EMPTY),
    () => EMPTY,
  )

  // Fetched once per signed-in user per session. `hydrated` is checked before
  // the request rather than after, so two components mounting together do not
  // both fetch.
  useEffect(() => {
    // Sign-out, or a different buyer signing in on the same browser. Without
    // this the new session would render the previous user's hearts until its
    // own fetch resolved.
    if (cachedFor !== userId) {
      cachedFor = userId
      __resetSavedVehicles()
    }

    if (!userId || hydrated.has(userId)) return

    hydrated.add(userId)
    const controller = new AbortController()

    getMyFavourites(controller.signal)
      .then((favourites) => {
        if (controller.signal.aborted) return
        write(
          userId,
          favourites.map((favourite) => favourite.vehicleId),
        )
      })
      .catch(() => {
        // A failed hydration leaves the list empty rather than breaking the
        // page. Allow a retry on the next mount.
        if (!controller.signal.aborted) hydrated.delete(userId)
      })

    return () => controller.abort()
  }, [userId])

  const isSaved = useCallback(
    (vehicleId: string) => savedIds.includes(vehicleId),
    [savedIds],
  )

  /**
   * Saves or unsaves, and resolves to the new state.
   *
   * Optimistic: the heart flips immediately and rolls back if the request
   * fails. A heart that waits on a round trip reads as an unresponsive button;
   * one that flips back with an explanation reads as a failure the buyer can
   * act on.
   */
  const toggle = useCallback(
    async (vehicleId: string): Promise<boolean> => {
      if (!userId) return false

      // Re-read rather than closing over `savedIds`: another component may have
      // written since this one last rendered.
      const current = read(userId)
      const nowSaved = !current.includes(vehicleId)
      const next = nowSaved
        ? [...current, vehicleId]
        : current.filter((id) => id !== vehicleId)

      write(userId, next)

      try {
        if (nowSaved) await addFavourite(vehicleId)
        else await removeFavourite(vehicleId)
        return nowSaved
      } catch (error) {
        // 409 on add or 404 on remove means the server already agrees; the
        // optimistic state was right and there is nothing to undo.
        if (isAlreadyInDesiredState(error, nowSaved ? 'add' : 'remove')) {
          return nowSaved
        }

        write(userId, current)
        throw error
      }
    },
    [userId],
  )

  return { savedIds, isSaved, toggle }
}
