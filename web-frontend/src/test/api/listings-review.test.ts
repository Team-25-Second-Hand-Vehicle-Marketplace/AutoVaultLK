import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const patch = vi.fn()
vi.mock('../../api/client', () => ({
  apiClient: { get, patch, post: vi.fn() },
  toErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

const { approveListing, approveSelectedListings, getMyListings } = await import('../../api/listings.api')

const ENVELOPE = { message: 'ok', data: { id: 'v-1' } }

/**
 * FR-42/FR-42.1. The path is the contract with
 * api-gateway/openapi/public-api.yaml - nginx proxies `location /marketplace/`
 * without stripping the prefix, so the URL the client builds is the URL the
 * service sees.
 */
describe('getMyListings', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: { message: 'ok', data: [] } })
  })

  it('calls the published /marketplace/listings/mine route', async () => {
    await getMyListings()

    expect(get).toHaveBeenCalledWith('/marketplace/listings/mine', expect.anything())
  })

  it('sends no sort param by default', async () => {
    await getMyListings()

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: undefined }),
    )
  })

  it('passes sort=confidence_asc through (FR-42.1)', async () => {
    await getMyListings('confidence_asc')

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { sort: 'confidence_asc' } }),
    )
  })

  // The listings page aborts in-flight requests on unmount/reload.
  it('forwards the abort signal', async () => {
    const controller = new AbortController()

    await getMyListings(undefined, controller.signal)

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('unwraps the envelope to the listing array', async () => {
    const listings = [{ id: 'v-1' }, { id: 'v-2' }]
    get.mockResolvedValue({ data: { message: 'ok', data: listings } })

    await expect(getMyListings()).resolves.toEqual(listings)
  })
})

describe('approveListing', () => {
  beforeEach(() => {
    patch.mockReset()
    patch.mockResolvedValue({ data: ENVELOPE })
  })

  it('calls the published /marketplace/listings/{id}/approve route', async () => {
    await approveListing('v-1')

    expect(patch).toHaveBeenCalledWith(
      '/marketplace/listings/v-1/approve',
      undefined,
      expect.anything(),
    )
  })

  it('sends no body', async () => {
    await approveListing('v-1')

    expect(patch.mock.calls[0][1]).toBeUndefined()
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()

    await approveListing('v-1', controller.signal)

    expect(patch).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('unwraps the envelope to the listing', async () => {
    const listing = { id: 'v-1', status: 'LIVE' }
    patch.mockResolvedValue({ data: { message: 'ok', data: listing } })

    await expect(approveListing('v-1')).resolves.toEqual(listing)
  })
})

describe('approveSelectedListings', () => {
  beforeEach(() => patch.mockReset())

  it('sends the ids to the approve-selected route and returns the counts', async () => {
    patch.mockResolvedValue({ data: { message: 'ok', data: { approved: 2, skipped: 1 } } })

    await expect(approveSelectedListings(['a', 'b', 'c'])).resolves.toEqual({
      approved: 2,
      skipped: 1,
    })
    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith(
      '/marketplace/listings/approve-selected',
      { ids: ['a', 'b', 'c'] },
      expect.anything(),
    )
  })

  it('splits a selection over the server limit into batches and sums the counts', async () => {
    patch.mockResolvedValue({ data: { message: 'ok', data: { approved: 1000, skipped: 0 } } })
    const ids = Array.from({ length: 2300 }, (_, i) => `id-${i}`)

    const result = await approveSelectedListings(ids)

    expect(patch).toHaveBeenCalledTimes(3)
    const sizes = patch.mock.calls.map(([, body]) => (body as { ids: string[] }).ids.length)
    expect(sizes).toEqual([1000, 1000, 300])
    expect(result.approved).toBe(3000)
  })
})
