import type { EmbeddedRow, Rejection, StageContext } from '../types';
import type {
  LoadedVehicle,
  MarketplaceVehiclesWriteAdapter,
} from './marketplace-vehicles-write.adapter';

export type LoadResult = {
  loaded: LoadedVehicle[];
  rejections: Rejection[];
};

/**
 * Writes a chunk's surviving rows to marketplace.vehicles.
 *
 * Not a StageRunner: every other stage is a pure function of its input, but
 * Load needs the write adapter, which is a Nest injectable holding the
 * DataSource. Constructing it per chunk would open a connection pool per chunk.
 * The orchestrator therefore builds this once and hands it in — the same shape
 * a Lambda handler would use, so nothing about deployment changes.
 *
 * Rows with a null registration number miss BOTH partial indexes: the global
 * one from migration 6000 and the composite upsert key from 19000. They can
 * neither conflict nor upsert, so a retry would insert them a second time.
 * That is why the orchestrator skips chunks already logged SUCCEEDED
 * (EtlStageLogRepository.succeededChunks) rather than relying on the database
 * to deduplicate — for these rows there is nothing to deduplicate against.
 */
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
