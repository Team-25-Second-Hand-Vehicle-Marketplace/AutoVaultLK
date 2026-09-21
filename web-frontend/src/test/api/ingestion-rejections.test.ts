import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('../../api/client', () => ({
  apiClient: { get, post: vi.fn() },
  toErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

const { getJobRejections } = await import('../../api/ingestion.api')

/**
 * FR-57. The path and the shape of the request are the contract with
 * api-gateway/openapi/public-api.yaml — nginx proxies `location /jobs/`
 * without stripping the prefix, so the URL the client builds is the URL the
 * service sees.
 */
describe('getJobRejections', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: { items: [], total: 0, page: 1, limit: 50, totalPages: 0 } })
  })

  it('calls the published /jobs/{id}/rejections route', async () => {
    await getJobRejections('job-1')

    expect(get).toHaveBeenCalledWith('/jobs/job-1/rejections', expect.anything())
  })

  it('requests the first page by default', async () => {
    await getJobRejections('job-1')

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { page: 1 } }),
    )
  })

  it('passes the requested page through', async () => {
    await getJobRejections('job-1', 3)

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { page: 3 } }),
    )
  })

  // The status page aborts in-flight requests on unmount; without the signal
  // a slow report would resolve into a dead component.
  it('forwards the abort signal', async () => {
    const controller = new AbortController()

    await getJobRejections('job-1', 1, controller.signal)

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('returns the page body unwrapped', async () => {
    const page = {
      items: [
        {
          rowNumber: 17,
          stage: 'VALIDATE_ROWS',
          reason: 'manufacture_year 1972 is outside the accepted range',
          rawData: { year: '1972' },
          rawDataTruncated: false,
          createdAt: '2026-09-01T10:03:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    }
    get.mockResolvedValue({ data: page })

    await expect(getJobRejections('job-1')).resolves.toEqual(page)
  })
})
