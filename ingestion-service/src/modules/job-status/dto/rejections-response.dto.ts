import type { EtlStage } from '../../../infrastructure/database/entities/etl-stage-log.entity';

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
