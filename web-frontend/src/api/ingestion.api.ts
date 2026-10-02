import { apiClient } from './client'
import type {
  JobsPage,
  JobStatus,
  RejectedRecord,
  RejectionsPage,
  UploadAccepted,
  UploadFileFormat,
} from './ingestion.types'
import { TEMPLATE_HEADER } from './ingestion.template'

/**
 * A bulk upload is up to INGESTION_MAX_UPLOAD_MB (25 MB by default) plus an
 * image archive, and the client's 10s default would abort a perfectly healthy
 * upload on a slow connection. The request only has to reach the service -
 * the pipeline itself runs asynchronously and is polled through getJobStatus.
 */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

export type UploadProgress = (percent: number) => void

/**
 * Field names are `file`, `format` and `zip` to match the FileFieldsInterceptor
 * on ingestion-service's IngestionController. Multer rejects any other file
 * field outright - a wrong name returns 400 "Unexpected field", not the
 * friendlier "inventory file is required".
 *
 * `format` is appended before the files: the server reads text fields from the
 * same multipart stream, and sending the declared format first keeps it
 * available however the body is parsed.
 */
export async function uploadInventory(
  format: UploadFileFormat,
  file: File,
  zip: File | null,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<UploadAccepted> {
  const form = new FormData()
  form.append('format', format)
  form.append('file', file)
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

/** Columns a JSON file writes as numbers, the way a real export would. */
const JSON_NUMERIC_COLUMNS = new Set(['year', 'price', 'mileage', 'engine_capacity_cc', 'owners_count'])

/**
 * The JSON counterpart of buildTemplateCsv: an array holding one example
 * vehicle, with every column the pipeline accepts present as a key.
 *
 * Columns with no example are `null`, which the pipeline reads as a blank
 * cell - so the dealer sees every field that exists, and can delete the ones
 * they do not use. Built from the same TEMPLATE_HEADER and EXAMPLE_ROW as the
 * CSV, so the two templates cannot drift apart.
 */
export function buildTemplateJson(): string {
  const vehicle: Record<string, string | number | null> = {}
  for (const column of TEMPLATE_HEADER) {
    const example = EXAMPLE_ROW[column]
    if (example === undefined) vehicle[column] = null
    else vehicle[column] = JSON_NUMERIC_COLUMNS.has(column) ? Number(example) : example
  }
  return `${JSON.stringify([vehicle], null, 2)}\n`
}

export function buildTemplate(format: UploadFileFormat): string {
  return format === 'json' ? buildTemplateJson() : buildTemplateCsv()
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
