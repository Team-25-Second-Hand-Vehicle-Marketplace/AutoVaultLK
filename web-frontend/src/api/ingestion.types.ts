/** Mirrors ingestion-service's UploadJobStatus union. */
export type UploadJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'

/** 202 body from POST /ingest/upload. */
export type UploadAccepted = {
  jobId: string
  status: UploadJobStatus
  fileName: string
  csvS3Path: string
  zipS3Path: string | null
}

/** GET /jobs/{id} — mirrors JobStatusResponseDto. */
export type JobStatus = {
  id: string
  status: UploadJobStatus
  fileName: string
  totalRecords: number
  validRecords: number
  invalidRecords: number
  createdAt: string
  updatedAt: string
}

/** Mirrors ingestion-service's EtlStage union. */
export type EtlStage =
  | 'VALIDATE_FILE'
  | 'SPLIT_CHUNKS'
  | 'PARSE_NORMALIZE'
  | 'GROQ_NORMALIZE'
  | 'VALIDATE_ROWS'
  | 'ENRICH'
  | 'EMBED'
  | 'LOAD'
  | 'PROCESS_IMAGES'
  | 'AGGREGATE'
  | 'NOTIFY'

/** One refused row — mirrors RejectedRecordDto. */
export type RejectedRecord = {
  /** 0 means the whole file was rejected, not a particular row. */
  rowNumber: number
  stage: EtlStage
  reason: string
  rawData: Record<string, unknown>
  /** True when rawData was trimmed to the server's column cap. */
  rawDataTruncated: boolean
  createdAt: string
}

/** GET /jobs/{id}/rejections — mirrors RejectionsResponseDto. */
export type RejectionsPage = {
  items: RejectedRecord[]
  total: number
  page: number
  limit: number
  totalPages: number
}

/**
 * A job stops changing once it reaches one of these, so the status page stops
 * polling. PARTIAL is terminal *and* a success: some rows were rejected with
 * reasons, the rest loaded.
 */
export const TERMINAL_STATUSES: readonly UploadJobStatus[] = [
  'COMPLETED',
  'PARTIAL',
  'FAILED',
]

export function isTerminal(status: UploadJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
