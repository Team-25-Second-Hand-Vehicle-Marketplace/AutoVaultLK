import type { RejectedRecordView } from '../../../infrastructure/database/entities/rejected-record.view-entity';

/**
 * Columns of the dealer's own row echoed back per rejection. Mirrors
 * ingestion-service's job-status.service.ts RAW_DATA_MAX_KEYS exactly — same
 * table, same reasoning: a 60-column export would make the response mostly
 * payload an admin never reads.
 */
const RAW_DATA_MAX_KEYS = 24;

export type RejectedRecordDto = {
  rowNumber: number;
  stage: string;
  reason: string;
  rawData: Record<string, unknown>;
  rawDataTruncated: boolean;
  createdAt: Date;
};

export type RejectionsResponseDto = {
  items: RejectedRecordDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function mapRejections(
  rows: RejectedRecordView[],
  total: number,
  page: number,
  limit: number,
): RejectionsResponseDto {
  return {
    items: rows.map(toDto),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

function toDto(row: RejectedRecordView): RejectedRecordDto {
  const { rawData, truncated } = capRawData(row.rawData);

  return {
    rowNumber: row.rowNumber,
    stage: row.stage,
    reason: row.reason,
    rawData,
    rawDataTruncated: truncated,
    createdAt: row.createdAt,
  };
}

function capRawData(rawData: Record<string, unknown> | null): {
  rawData: Record<string, unknown>;
  truncated: boolean;
} {
  if (!rawData) return { rawData: {}, truncated: false };

  const keys = Object.keys(rawData);
  if (keys.length <= RAW_DATA_MAX_KEYS) {
    return { rawData, truncated: false };
  }

  const capped: Record<string, unknown> = {};
  for (const key of keys.slice(0, RAW_DATA_MAX_KEYS)) {
    capped[key] = rawData[key];
  }

  return { rawData: capped, truncated: true };
}
