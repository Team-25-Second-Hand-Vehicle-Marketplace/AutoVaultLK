import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useSavedVehicles, __resetSavedVehicles } from '../../hooks/useSavedVehicles'
import {
  addFavourite,
  getMyFavourites,
  removeFavourite,
} from '../../api/favourites.api'
import { useAuth } from '../../auth/useAuth'
import type { Favourite } from '../../api/favourites.types'

vi.mock('../../api/favourites.api', async () => {
  // isAlreadyInDesiredState stays real — it is the 409/404 rule under test.
  const actual = await vi.importActual<typeof import('../../api/favourites.api')>(
    '../../api/favourites.api',
  )
  return {
    ...actual,
    getMyFavourites: vi.fn(),
    addFavourite: vi.fn(),
    removeFavourite: vi.fn(),
  }
})

vi.mock('../../auth/useAuth', () => ({ useAuth: vi.fn() }))

const favourite = (vehicleId: string): Favourite =>
  ({ id: `f-${vehicleId}`, buyerId: 'buyer-1', vehicleId, createdAt: '', vehicle: {} }) as never

const signedIn = (id = 'buyer-1') =>
  vi.mocked(useAuth).mockReturnValue({ user: { id } } as never)

/** An axios-shaped rejection, which is what the real client throws. */
const httpError = (status: number) => ({
  isAxiosError: true,
  response: { status },
  message: `Request failed with status code ${status}`,
})

describe('useSavedVehicles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetSavedVehicles()
    signedIn()
    vi.mocked(getMyFavourites).mockResolvedValue([])
    vi.mocked(addFavourite).mockResolvedValue(favourite('v-1'))
    vi.mocked(removeFavourite).mockResolvedValue({ message: 'ok' })
  })

  describe('hydration', () => {
    it('loads the saved list from the server on mount', async () => {
      // The whole point of the change: the list comes from the database, so it
      // survives a device change.
      vi.mocked(getMyFavourites).mockResolvedValue([favourite('v-1'), favourite('v-2')])

      const { result } = renderHook(() => useSavedVehicles())

      await waitFor(() => expect(result.current.savedIds).toEqual(['v-1', 'v-2']))
    })

    it('fetches once even when several components mount together', async () => {
      // Every card on a search page renders a SaveButton; one request per card
      // would be a page-load storm.
      renderHook(() => useSavedVehicles())
      renderHook(() => useSavedVehicles())
      renderHook(() => useSavedVehicles())

      await waitFor(() => expect(getMyFavourites).toHaveBeenCalledTimes(1))
    })

    it('does not fetch for a guest', async () => {
      vi.mocked(useAuth).mockReturnValue({ user: null } as never)

      const { result } = renderHook(() => useSavedVehicles())

      expect(result.current.savedIds).toEqual([])
      expect(getMyFavourites).not.toHaveBeenCalled()
    })

    it('leaves the list empty when the fetch fails', async () => {
      // A favourites outage must not break the page the buyer is on.
      vi.mocked(getMyFavourites).mockRejectedValue(new Error('network down'))

      const { result } = renderHook(() => useSavedVehicles())

      await waitFor(() => expect(getMyFavourites).toHaveBeenCalled())
      expect(result.current.savedIds).toEqual([])
    })

    it('clears the cache when a different buyer signs in', async () => {
      // Two buyers on one browser: the second must not see the first's hearts
      // between mount and their own fetch resolving.
      vi.mocked(getMyFavourites).mockResolvedValue([favourite('v-1')])
      const first = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(first.result.current.savedIds).toEqual(['v-1']))

      signedIn('buyer-2')
      vi.mocked(getMyFavourites).mockResolvedValue([favourite('v-9')])
      const second = renderHook(() => useSavedVehicles())

      await waitFor(() => expect(second.result.current.savedIds).toEqual(['v-9']))
    })
  })

  describe('toggle', () => {
    it('saves a vehicle and reports the new state', async () => {
      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(getMyFavourites).toHaveBeenCalled())

      let nowSaved: boolean | undefined
      await act(async () => {
        nowSaved = await result.current.toggle('v-1')
      })

      expect(nowSaved).toBe(true)
      expect(addFavourite).toHaveBeenCalledWith('v-1')
      expect(result.current.savedIds).toEqual(['v-1'])
    })

    it('removes a saved vehicle', async () => {
      vi.mocked(getMyFavourites).mockResolvedValue([favourite('v-1')])
      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(result.current.savedIds).toEqual(['v-1']))

      let nowSaved: boolean | undefined
      await act(async () => {
        nowSaved = await result.current.toggle('v-1')
      })

      expect(nowSaved).toBe(false)
      expect(removeFavourite).toHaveBeenCalledWith('v-1')
      expect(result.current.savedIds).toEqual([])
    })

    it('updates optimistically, before the request resolves', async () => {
      // A heart that waits on a round trip reads as an unresponsive button.
      let release: () => void = () => {}
      vi.mocked(addFavourite).mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve(favourite('v-1'))
        }),
      )

      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(getMyFavourites).toHaveBeenCalled())

      let pending: Promise<boolean> | undefined
      act(() => {
        pending = result.current.toggle('v-1')
      })

      // Already saved locally while the request is still in flight.
      expect(result.current.savedIds).toEqual(['v-1'])

      await act(async () => {
        release()
        await pending
      })
    })

    it('rolls back and rethrows when the request fails', async () => {
      // The caller shows the message; the hook makes sure the heart tells the
      // truth again.
      vi.mocked(addFavourite).mockRejectedValue(new Error('network down'))

      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(getMyFavourites).toHaveBeenCalled())

      await expect(
        act(async () => {
          await result.current.toggle('v-1')
        }),
      ).rejects.toThrow('network down')

      expect(result.current.savedIds).toEqual([])
    })

    it('treats a 409 on add as already saved', async () => {
      // The server and client agree; surfacing that as a failure would roll
      // back a heart that is correctly filled.
      vi.mocked(addFavourite).mockRejectedValue(httpError(409))

      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(getMyFavourites).toHaveBeenCalled())

      let nowSaved: boolean | undefined
      await act(async () => {
        nowSaved = await result.current.toggle('v-1')
      })

      expect(nowSaved).toBe(true)
      expect(result.current.savedIds).toEqual(['v-1'])
    })

    it('treats a 404 on remove as already removed', async () => {
      vi.mocked(getMyFavourites).mockResolvedValue([favourite('v-1')])
      vi.mocked(removeFavourite).mockRejectedValue(httpError(404))

      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(result.current.savedIds).toEqual(['v-1']))

      let nowSaved: boolean | undefined
      await act(async () => {
        nowSaved = await result.current.toggle('v-1')
      })

      expect(nowSaved).toBe(false)
      expect(result.current.savedIds).toEqual([])
    })

    it('does nothing for a guest', async () => {
      vi.mocked(useAuth).mockReturnValue({ user: null } as never)

      const { result } = renderHook(() => useSavedVehicles())

      let nowSaved: boolean | undefined
      await act(async () => {
        nowSaved = await result.current.toggle('v-1')
      })

      expect(nowSaved).toBe(false)
      expect(addFavourite).not.toHaveBeenCalled()
    })
  })

  describe('isSaved', () => {
    it('reflects the hydrated list', async () => {
      vi.mocked(getMyFavourites).mockResolvedValue([favourite('v-1')])

      const { result } = renderHook(() => useSavedVehicles())
      await waitFor(() => expect(result.current.isSaved('v-1')).toBe(true))

      expect(result.current.isSaved('v-2')).toBe(false)
    })
  })

  it('keeps two hook instances in step', async () => {
    // Two SaveButtons for the same vehicle — a search card and the detail page
    // — must not disagree.
    const a = renderHook(() => useSavedVehicles())
    const b = renderHook(() => useSavedVehicles())
    await waitFor(() => expect(getMyFavourites).toHaveBeenCalled())

    await act(async () => {
      await a.result.current.toggle('v-1')
    })

    expect(b.result.current.isSaved('v-1')).toBe(true)
  })
})
