import axios from 'axios'
import { apiClient } from './client'
import type {
  JobsPage,
  JobStatus,
  PresignedUpload,
  PresignedUploadTarget,
  RejectedRecord,
  RejectionsPage,
  UploadAccepted,
} from './ingestion.types'
import { TEMPLATE_HEADER } from './ingestion.template'

/**
 * A bulk upload is up to 25 MB plus a 250 MB image archive, and the client's
 * 10s default would abort a perfectly healthy upload on a slow connection.
 */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

export type UploadProgress = (percent: number) => void

/**
 * Three steps, because API Gateway hard-caps a Lambda-proxied request body at
 * 10 MB (not a configurable quota) - well under either file, so they can
 * never reliably arrive as part of a normal request to our own API:
 *
 *   1. POST /ingest/presign - creates the job, returns a presigned PUT per file.
 *   2. PUT the file(s) straight to storage - this service never sees the bytes.
 *   3. POST /ingest/upload/{jobId}/complete - confirms they landed, starts the pipeline.
 *
 * If step 2 or 3 fails, step 3 is still attempted (best-effort) so the
 * backend can mark the job FAILED rather than leave it at PENDING forever -
 * which getActiveJob() would otherwise treat as still in progress and block
 * the dealer from trying again.
 */
export async function uploadInventory(
  csv: File,
  zip: File | null,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<UploadAccepted> {
  const presigned = await presignUpload(csv, zip, signal)

  const totalBytes = csv.size + (zip?.size ?? 0)
  let csvLoaded = 0
  let zipLoaded = 0
  const reportProgress = () => {
    if (!onProgress || totalBytes === 0) return
    // Capped below 100 until /complete actually succeeds, so the UI's
    // "Processing…" state only shows once the pipeline has really started.
    onProgress(Math.min(99, Math.round(((csvLoaded + zipLoaded) / totalBytes) * 100)))
  }

  try {
    await putDirect(presigned.csv, csv, signal, (loaded) => {
      csvLoaded = loaded
      reportProgress()
    })

    if (zip && presigned.zip) {
      await putDirect(presigned.zip, zip, signal, (loaded) => {
        zipLoaded = loaded
        reportProgress()
      })
    }
  } catch (err) {
    await completeUpload(presigned.jobId, signal).catch(() => {
      /* best-effort - see the doc comment above */
    })
    throw err
  }

  onProgress?.(100)

  return completeUpload(presigned.jobId, signal)
}

async function presignUpload(
  csv: File,
  zip: File | null,
  signal?: AbortSignal,
): Promise<PresignedUpload> {
  const { data } = await apiClient.post<PresignedUpload>(
    '/ingest/presign',
    {
      csvFileName: csv.name,
      csvFileSize: csv.size,
      ...(zip ? { zipFileName: zip.name, zipFileSize: zip.size } : {}),
    },
    { signal },
  )
  return data
}

function completeUpload(jobId: string, signal?: AbortSignal): Promise<UploadAccepted> {
  return apiClient
    .post<UploadAccepted>(`/ingest/upload/${jobId}/complete`, undefined, { signal })
    .then((res) => res.data)
}

/**
 * Deliberately not apiClient: this goes straight to storage (S3 in
 * production, a same-origin dev mirror locally - see
 * LocalObjectStore.getUploadTarget), which must never see our app's auth
 * cookie or bearer token. S3's CORS does not support credentialed requests
 * at all, so sending them would make the browser block the request outright.
 */
async function putDirect(
  target: PresignedUploadTarget,
  file: File,
  signal: AbortSignal | undefined,
  onLoaded: (loaded: number) => void,
): Promise<void> {
  await axios.put(target.uploadUrl, file, {
    signal,
    timeout: UPLOAD_TIMEOUT_MS,
    headers: target.headers,
    withCredentials: false,
    onUploadProgress: (event) => onLoaded(event.loaded),
  })
}

export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
  const { data } = await apiClient.get<JobStatus>(`/jobs/${jobId}`, { signal })
  return data
}

/**
 * The dealer's own most recent job that hasn't settled yet, if any - lets the
 * Bulk Upload page notice "you already have one running" instead of showing a
 * blank form a dealer who navigated away and came back could resubmit into.
 */
export async function getActiveJob(signal?: AbortSignal): Promise<{ id: string } | null> {
  const { data } = await apiClient.get<{ id: string } | null>('/jobs/active', { signal })
  return data
}

/**
 * FR-57: the row-level report behind the counts on getJobStatus.
 *
 * Only worth calling once a job is terminal - before that the pipeline is
 * still writing rejections and the page would be a moving target.
 */
export async function getJobRejections(
  jobId: string,
  page = 1,
  limit?: number,
  signal?: AbortSignal,
): Promise<RejectionsPage> {
  const { data } = await apiClient.get<RejectionsPage>(`/jobs/${jobId}/rejections`, {
    params: limit ? { page, limit } : { page },
    signal,
  })
  return data
}

/**
 * The dealer's own upload history, newest first - lets the dealer find their
 * way back to a past job's rejection report after navigating away, since
 * getActiveJob only ever covers the one still running.
 */
export async function getMyUploadJobs(page = 1, signal?: AbortSignal): Promise<JobsPage> {
  const { data } = await apiClient.get<JobsPage>('/jobs/mine', {
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
 * csv-contract.ts - see the note in ingestion.template.ts.
 */
/**
 * Keyed by column name rather than a positional array - TEMPLATE_HEADER's
 * order is a plain copy of csv-contract.ts's KNOWN_COLUMNS and can shift if
 * that list is reordered; a keyed example survives that, a positional one
 * would silently put values under the wrong header.
 */
const EXAMPLE_ROW: Record<string, string> = {
  vehicle_type: 'Car',
  registration_number: 'CAB-1234',
  make: 'Toyota',
  model: 'Vitz',
  year: '2015',
  price: '3500000',
  mileage: '45000',
  fuel_type: 'Petrol',
  transmission: 'Automatic',
  body_type: 'Hatchback',
  condition: 'Used',
  engine_capacity_cc: '1500',
  color: 'White',
  owners_count: '1',
  location_city: 'Colombo',
  location_district: 'Colombo',
}

export function buildTemplateCsv(): string {
  const example = TEMPLATE_HEADER.map((column) => EXAMPLE_ROW[column] ?? '')
  return `${TEMPLATE_HEADER.join(',')}\n${example.join(',')}\n`
}

/**
 * FR-57's export: a dealer fixing skipped rows needs them outside the
 * browser, not just on screen - re-typing which rows failed from a table is
 * exactly the manual, error-prone step this is meant to remove.
 *
 * `row` and `reason` lead the file for reference. They are not template
 * columns, but a stray extra column is not a re-upload hazard either: the
 * parser folds anything it does not recognise into `description` rather than
 * rejecting the file (see COLUMN_HELP), so the worst case if a dealer forgets
 * to delete them is a stray note in the description field, not a failed
 * re-upload. The download hint says to remove them regardless.
 */
export function buildRejectionsCsv(rows: RejectedRecord[]): string {
  const rawKeys = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row.rawData)) rawKeys.add(key)
  }
  const templateKeys = TEMPLATE_HEADER.filter((key) => rawKeys.has(key))
  const extraKeys = [...rawKeys].filter((key) => !(TEMPLATE_HEADER as readonly string[]).includes(key)).sort()
  const columns = [...templateKeys, ...extraKeys]

  const header = ['row', 'reason', ...columns]
  const lines = [header.map(csvCell).join(',')]

  for (const row of rows) {
    const cells = [
      row.rowNumber === 0 ? 'whole file' : String(row.rowNumber),
      row.reason,
      ...columns.map((key) => {
        const value = row.rawData[key]
        return value === null || value === undefined ? '' : String(value)
      }),
    ]
    lines.push(cells.map(csvCell).join(','))
  }

  return `${lines.join('\n')}\n`
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
