import type { EmbeddedRow, Rejection, StageContext } from '../types';
import type {
  LoadedVehicle,
  MarketplaceVehiclesWriteAdapter,
} from './marketplace-vehicles-write.adapter';

export type LoadResult = {
  loaded: LoadedVehicle[];
  rejections: Rejection[];
};

export function createLoadStage(adapter: MarketplaceVehiclesWriteAdapter) {
  return {
    stage: 'LOAD' as const,

    async run(ctx: StageContext, rows: EmbeddedRow[]): Promise<LoadResult> {
      if (rows.length === 0) return { loaded: [], rejections: [] };

      return adapter.upsertBatch(ctx.jobId, ctx.dealerId, rows);
    },
  };
}

export type LoadStage = ReturnType<typeof createLoadStage>;
