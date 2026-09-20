import { apiClient } from './client'
import type { JobStatus, RejectionsPage, UploadAccepted } from './ingestion.types'
import { TEMPLATE_HEADER } from './ingestion.template'

/**
 * A bulk upload is up to INGESTION_MAX_UPLOAD_MB (25 MB by default) plus an
 * image archive, and the client's 10s default would abort a perfectly healthy
 * upload on a slow connection. The request only has to reach the service —
 * the pipeline itself runs asynchronously and is polled through getJobStatus.
 */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

export type UploadProgress = (percent: number) => void

/**
 * Field names are `csv` and `zip` to match the FileFieldsInterceptor on
 * ingestion-service's IngestionController. Multer rejects any other field
 * outright — a wrong name returns 400 "Unexpected field", not the friendlier
 * "csv file is required".
 */
export async function uploadInventory(
  csv: File,
  zip: File | null,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<UploadAccepted> {
  const form = new FormData()
  form.append('csv', csv)
  if (zip) form.append('zip', zip)

  const { data } = await apiClient.post<UploadAccepted>('/ingest/upload', form, {
    signal,
    timeout: UPLOAD_TIMEOUT_MS,
    // Content-Type is deliberately unset: the browser has to add the multipart
    // boundary itself, and naming the header here would overwrite it with one
    // that has no boundary.
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return
      onProgress(Math.round((event.loaded / event.total) * 100))
    },
  })

  return data
}

export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const { data } = await apiClient.get<JobStatus>(`/jobs/${jobId}`, { signal })
  return data
}

/**
 * FR-57: the row-level report behind the counts on getJobStatus.
 *
 * Only worth calling once a job is terminal — before that the pipeline is
 * still writing rejections and the page would be a moving target.
 */
export async function getJobRejections(
  jobId: string,
  page = 1,
  signal?: AbortSignal,
): Promise<RejectionsPage> {
  const { data } = await apiClient.get<RejectionsPage>(`/jobs/${jobId}/rejections`, {
    params: { page },
    signal,
  })
  return data
}

/**
 * Builds the starter CSV from the same column list the parser accepts.
 *
 * A file the dealer downloads and fills in is the one upload guaranteed to
 * validate, so the header must not drift from ingestion-service's
 * csv-contract.ts — see the note in ingestion.template.ts.
 */
export function buildTemplateCsv(): string {
  const example = [
    'CAB-1234',
    'Toyota',
    'Vitz',
    '2015',
    '3500000',
    '45000',
    'Petrol',
    'Automatic',
    'Hatchback',
  ]

  return `${TEMPLATE_HEADER.join(',')}\n${example.join(',')}\n`
}
