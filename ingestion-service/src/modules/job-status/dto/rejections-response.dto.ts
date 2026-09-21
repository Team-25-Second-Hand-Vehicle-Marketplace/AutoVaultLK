import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';

/**
 * One row the pipeline refused, as the dealer needs to see it: which row, what
 * was wrong, and what they actually submitted.
 *
 * `rawData` is the dealer's own row echoed back — it is what makes the report
 * actionable, since the reason alone ("year out of range") does not say which
 * value to correct. It is capped at RAW_DATA_MAX_KEYS columns by the service:
 * a wide CSV with 60 columns per row would otherwise dominate the response.
 */
export class RejectedRecordDto {
  /** 0 means the whole file was rejected, not a particular row. */
  rowNumber: number;

  stage: EtlStage;

  reason: string;

  rawData: Record<string, unknown>;

  /** True when rawData was trimmed, so the UI can say so rather than imply the row was that narrow. */
  rawDataTruncated: boolean;

  createdAt: Date;
}

export class RejectionsResponseDto {
  items: RejectedRecordDto[];

  total: number;

  page: number;

  limit: number;

  totalPages: number;
}
