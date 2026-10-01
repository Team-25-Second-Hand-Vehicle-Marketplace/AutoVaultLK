import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('../../api/client', () => ({
  apiClient: { get, post: vi.fn() },
  toErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

const { getMyUploadJobs } = await import('../../api/ingestion.api')

/**
 * The dealer's upload history - lets a dealer find their way back to a past
 * job's rejection report after navigating away.
 */
describe('getMyUploadJobs', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockResolvedValue({ data: { items: [], total: 0, page: 1, limit: 20, totalPages: 0 } })
  })

  it('calls the published /jobs/mine route', async () => {
    await getMyUploadJobs()

    expect(get).toHaveBeenCalledWith('/jobs/mine', expect.anything())
  })

  it('requests the first page by default', async () => {
    await getMyUploadJobs()

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { page: 1 } }),
    )
  })

  it('passes the requested page through', async () => {
    await getMyUploadJobs(3)

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { page: 3 } }),
    )
  })

  it('forwards the abort signal', async () => {
    const controller = new AbortController()

    await getMyUploadJobs(1, controller.signal)

    expect(get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('returns the page body unwrapped', async () => {
    const page = {
      items: [
        {
          id: 'job-1',
          status: 'PARTIAL',
          fileName: 'stock.csv',
          totalRecords: 40,
          validRecords: 34,
          invalidRecords: 6,
          createdAt: '2026-09-01T10:00:00.000Z',
          updatedAt: '2026-09-01T10:02:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    }
    get.mockResolvedValue({ data: page })

    await expect(getMyUploadJobs()).resolves.toEqual(page)
  })
})
