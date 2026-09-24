import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('../../api/client', () => ({
  apiClient: { get: vi.fn(), patch: vi.fn(), post },
  toErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

const { uploadListingImages } = await import('../../api/listings.api')

const file = (name = 'front.jpg') => new File(['bytes'], name, { type: 'image/jpeg' })

/**
 * FR-58. The path and multipart shape are the contract with
 * api-gateway/openapi/public-api.yaml's uploadListingImages operation —
 * nginx proxies `location /marketplace/` without stripping the prefix, so
 * the URL the client builds is the URL the service sees.
 */
describe('uploadListingImages', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({ data: { message: 'ok', data: [] } })
  })

  it('calls the published /marketplace/listings/{id}/images route', async () => {
    await uploadListingImages('v-1', [file()])

    expect(post).toHaveBeenCalledWith(
      '/marketplace/listings/v-1/images',
      expect.any(FormData),
      expect.anything(),
    )
  })

  it('appends every file under the images field', async () => {
    await uploadListingImages('v-1', [file('a.jpg'), file('b.jpg')])

    const form = post.mock.calls[0][1] as FormData
    const entries = form.getAll('images') as File[]
    expect(entries.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()

    await uploadListingImages('v-1', [file()], controller.signal)

    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(FormData),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('unwraps the envelope to the created rows', async () => {
    const rows = [{ id: 'img-1', vehicleId: 'v-1', s3Path: 'x', isPrimary: true, displayOrder: 0 }]
    post.mockResolvedValue({ data: { message: 'ok', data: rows } })

    await expect(uploadListingImages('v-1', [file()])).resolves.toEqual(rows)
  })
})
