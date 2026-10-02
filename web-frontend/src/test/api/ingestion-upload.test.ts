import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('../../api/client', () => ({
  apiClient: { get: vi.fn(), post },
  toErrorMessage: (_e: unknown, fallback: string) => fallback,
}))

const put = vi.fn()
vi.mock('axios', () => ({ default: { put } }))

const { uploadInventory } = await import('../../api/ingestion.api')

function file(name: string, size: number): File {
  return new File([new Uint8Array(size)], name)
}

const presignedBody = {
  jobId: 'job-1',
  csv: { uploadUrl: 'https://s3/csv', headers: { 'Content-Type': 'text/csv' } },
  zip: { uploadUrl: 'https://s3/zip', headers: { 'Content-Type': 'application/zip' } },
}

/**
 * Direct-to-S3 upload: API Gateway hard-caps a Lambda-proxied request body at
 * 10 MB, well under either file, so the browser presigns, PUTs straight to
 * storage, then confirms - this service never sees the bytes.
 */
describe('uploadInventory', () => {
  beforeEach(() => {
    post.mockReset()
    put.mockReset()
    put.mockResolvedValue({})
  })

  it('presigns, PUTs directly, then confirms - in that order', async () => {
    post
      .mockResolvedValueOnce({ data: presignedBody })
      .mockResolvedValueOnce({ data: { jobId: 'job-1', status: 'PENDING', fileName: 'a.csv', csvS3Path: 'raw/job-1/a.csv', zipS3Path: null } })

    await uploadInventory(file('a.csv', 10), null)

    expect(post).toHaveBeenNthCalledWith(
      1,
      '/ingest/presign',
      expect.objectContaining({ csvFileName: 'a.csv', csvFileSize: 10 }),
      expect.anything(),
    )
    expect(put).toHaveBeenCalledWith(
      'https://s3/csv',
      expect.anything(),
      expect.objectContaining({ headers: { 'Content-Type': 'text/csv' } }),
    )
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/ingest/upload/job-1/complete',
      undefined,
      expect.anything(),
    )
  })

  it('never sends credentials to the direct-upload target - S3 CORS does not support them', async () => {
    post.mockResolvedValueOnce({ data: presignedBody }).mockResolvedValueOnce({ data: {} })

    await uploadInventory(file('a.csv', 10), null)

    expect(put).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ withCredentials: false }),
    )
  })

  it('omits the zip presign request when no zip file is given', async () => {
    post.mockResolvedValueOnce({ data: { ...presignedBody, zip: null } }).mockResolvedValueOnce({
      data: {},
    })

    await uploadInventory(file('a.csv', 10), null)

    expect(put).toHaveBeenCalledTimes(1)
  })

  it('PUTs both files when a zip is given', async () => {
    post.mockResolvedValueOnce({ data: presignedBody }).mockResolvedValueOnce({ data: {} })

    await uploadInventory(file('a.csv', 10), file('photos.zip', 20))

    expect(put).toHaveBeenCalledTimes(2)
    expect(put).toHaveBeenCalledWith('https://s3/zip', expect.anything(), expect.anything())
  })

  it('reports upload progress scaled across both files, capped below 100 until complete', async () => {
    post.mockResolvedValueOnce({ data: presignedBody }).mockResolvedValueOnce({ data: {} })
    put
      .mockImplementationOnce(async (_url, _body, config) => {
        config.onUploadProgress({ loaded: 10 }) // all of the 10-byte csv
        return {}
      })
      .mockImplementationOnce(async (_url, _body, config) => {
        config.onUploadProgress({ loaded: 20 }) // all of the 20-byte zip
        return {}
      })
    const onProgress = vi.fn()

    await uploadInventory(file('a.csv', 10), file('photos.zip', 20), onProgress)

    // 10/30 after the csv, 30/30 after the zip - but capped at 99 until the
    // final complete() call actually succeeds.
    expect(onProgress).toHaveBeenCalledWith(33)
    expect(onProgress).toHaveBeenCalledWith(99)
    // Only reaches 100 once /complete has actually succeeded.
    expect(onProgress).toHaveBeenLastCalledWith(100)
  })

  it('still calls complete (best-effort) when the direct PUT fails, so the job does not linger as PENDING', async () => {
    post.mockResolvedValueOnce({ data: presignedBody })
    put.mockRejectedValueOnce(new Error('connection dropped'))
    post.mockResolvedValueOnce({ data: {} }) // the best-effort complete() call

    await expect(uploadInventory(file('a.csv', 10), null)).rejects.toThrow('connection dropped')

    expect(post).toHaveBeenNthCalledWith(
      2,
      '/ingest/upload/job-1/complete',
      undefined,
      expect.anything(),
    )
  })

  it('still surfaces the original PUT failure even if the best-effort complete call also fails', async () => {
    post.mockResolvedValueOnce({ data: presignedBody })
    put.mockRejectedValueOnce(new Error('connection dropped'))
    post.mockRejectedValueOnce(new Error('complete also failed'))

    await expect(uploadInventory(file('a.csv', 10), null)).rejects.toThrow('connection dropped')
  })
})
