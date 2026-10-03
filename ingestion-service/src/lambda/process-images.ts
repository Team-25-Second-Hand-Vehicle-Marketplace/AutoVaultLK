import { getContext } from './bootstrap';
import { VehicleImageWriteEntity } from '../infrastructure/database/entities/vehicle-image.write-entity';
import { VehicleWriteEntity } from '../infrastructure/database/entities/vehicle.write-entity';
import { ProcessJobImagesService } from '../workers/etl-worker/pipeline/image-processing/process-job-images.service';
import { VehicleImageRepository } from '../workers/etl-worker/pipeline/image-processing/vehicle-image.repository';

export type ProcessImagesInput = {
  jobId: string;
  zipKey: string | null;
};

// Wired here, not in bootstrap.ts's shared LambdaContext: ProcessJobImagesService
// pulls in `sharp`, a native module. This Lambda is packaged as a container
// image (Docker, built for linux-x64 directly), so that's safe here - it is
// not safe in bootstrap.ts, which every esbuild-bundled zip stage Lambda
// imports too, and esbuild can't bundle sharp's native binary into a zip.
let cachedImageProcessing: ProcessJobImagesService | undefined;

async function getImageProcessing(): Promise<ProcessJobImagesService> {
  if (cachedImageProcessing) return cachedImageProcessing;

  const ctx = await getContext();
  const vehicleImages = new VehicleImageRepository(
    ctx.dataSource.getRepository(VehicleWriteEntity),
    ctx.dataSource.getRepository(VehicleImageWriteEntity),
    ctx.dataSource,
  );
  cachedImageProcessing = new ProcessJobImagesService(vehicleImages);
  return cachedImageProcessing;
}

export type ProcessImagesOutput = {
  jobId: string;
  extracted: number;
  processed: number;
  skipped: number;
  unmatched: number;
  duplicates: number;
  failed: number;
};

export const handler = async (
  input: ProcessImagesInput,
): Promise<ProcessImagesOutput> => {
  const ctx = await getContext();
  const log = ctx.stageLogs.forJob(input.jobId);
  const logId = await log.start('PROCESS_IMAGES', null);

  if (!input.zipKey) {
    await log.finish(logId, 'SKIPPED', { metrics: { reason: 'no_zip' } });
    return {
      jobId: input.jobId,
      extracted: 0,
      processed: 0,
      skipped: 0,
      unmatched: 0,
      duplicates: 0,
      failed: 0,
    };
  }

  try {
    const imageProcessing = await getImageProcessing();
    const result = await imageProcessing.run(ctx.store, {
      jobId: input.jobId,
      zipKey: input.zipKey,
    });

    await log.finish(
      logId,
      result.failed > 0 || result.unmatched > 0 ? 'DEGRADED' : 'SUCCEEDED',
      { metrics: result },
    );

    return { jobId: input.jobId, ...result };
  } catch (err) {
    await log.finish(logId, 'FAILED', {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};
