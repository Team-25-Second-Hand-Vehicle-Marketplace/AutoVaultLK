import { Injectable, Logger } from '@nestjs/common';
import type { ObjectStore } from '../../../../infrastructure/ports/object-store.port';
import {
  extractImagesStage,
  type ExtractedImage,
} from '../image/extract-images.stage';
import {
  processVehicleImage,
  type ImageProcessingOutput,
} from './image-processing.stage';
import { VehicleImageRepository } from './vehicle-image.repository';

type ImageProcessor = (
  objectStore: ObjectStore,
  input: Parameters<typeof processVehicleImage>[1],
) => Promise<ImageProcessingOutput>;

export type ProcessJobImagesInput = {
  jobId: string;
  zipKey: string | null;
};

const MATCH_RETRY_BUDGET_MS = 30_000;
const MATCH_RETRY_INTERVAL_MS = 500;

export type ProcessJobImagesResult = {
  extracted: number;
  processed: number;
  skipped: number;
  unmatched: number;
  duplicates: number;
  failed: number;
};

@Injectable()
export class ProcessJobImagesService {
  private readonly logger = new Logger(ProcessJobImagesService.name);
  private processor: ImageProcessor = processVehicleImage;
  private matchRetryBudgetMs = MATCH_RETRY_BUDGET_MS;
  private matchRetryIntervalMs = MATCH_RETRY_INTERVAL_MS;

  constructor(private readonly vehicleImages: VehicleImageRepository) {}

  setImageProcessorForTest(processor: ImageProcessor): void {
    this.processor = processor;
  }

  /** Shrinks the match-retry wait so tests exercising "unmatched" do not pay MATCH_RETRY_BUDGET_MS. */
  setMatchRetryTimingForTest(budgetMs: number, intervalMs: number): void {
    this.matchRetryBudgetMs = budgetMs;
    this.matchRetryIntervalMs = intervalMs;
  }

  async run(
    objectStore: ObjectStore,
    input: ProcessJobImagesInput,
  ): Promise<ProcessJobImagesResult> {
    const result: ProcessJobImagesResult = {
      extracted: 0,
      processed: 0,
      skipped: 0,
      unmatched: 0,
      duplicates: 0,
      failed: 0,
    };

    if (!input.zipKey) {
      return result;
    }

    const { images } = await extractImagesStage(objectStore, {
      jobId: input.jobId,
      zipKey: input.zipKey,
    });

    result.extracted = images.length;

    for (const image of images) {
      const outcome = await this.processOne(objectStore, input.jobId, image);
      result[outcome] += 1;
    }

    result.skipped = result.unmatched + result.duplicates + result.failed;

    return result;
  }

  private async processOne(
    objectStore: ObjectStore,
    jobId: string,
    image: ExtractedImage,
  ): Promise<'processed' | 'unmatched' | 'duplicates' | 'failed'> {
    const vehicle = await this.findVehicleWithRetry(jobId, image.registrationNumber);

    if (!vehicle) {
      this.logger.warn(
        `Skipping image ${image.fileName}: no vehicle for registration ${image.registrationNumber} in job ${jobId} after ${this.matchRetryBudgetMs}ms`,
      );
      return 'unmatched';
    }

    const existing = await this.vehicleImages.findImageBySource(
      vehicle.id,
      image.key,
    );

    if (existing) {
      return 'duplicates';
    }

    const displayOrder = await this.vehicleImages.countImagesForVehicle(
      vehicle.id,
    );

    let processed: ImageProcessingOutput;
    try {
      processed = await this.processor(objectStore, {
        jobId,
        vehicleId: vehicle.id,
        sourceKey: image.key,
        displayOrder,
        isPrimary: displayOrder === 0,
      });
    } catch (err) {
      if (!isImageProcessingFailure(err)) {
        throw err;
      }

      this.logger.warn(`Skipping image ${image.fileName}: ${messageOf(err)}`);
      return 'failed';
    }

    await this.vehicleImages.insertImage({
      vehicleId: vehicle.id,
      s3Path: image.key,
      processedPath: processed.processedKey,
      thumbnailPath: processed.thumbnailKey,
      isPrimary: processed.isPrimary,
      displayOrder: processed.displayOrder,
    });

    return 'processed';
  }

  private async findVehicleWithRetry(
    jobId: string,
    registrationNumber: string,
  ): ReturnType<VehicleImageRepository['findVehicleByRegistration']> {
    const deadline = Date.now() + this.matchRetryBudgetMs;

    for (;;) {
      const vehicle = await this.vehicleImages.findVehicleByRegistration(
        registrationNumber,
        jobId,
      );
      if (vehicle) return vehicle;

      if (await this.vehicleImages.wasRejected(jobId, registrationNumber)) {
        return null;
      }

      if (Date.now() >= deadline) return null;

      await sleep(this.matchRetryIntervalMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isImageProcessingFailure(err: unknown): boolean {
  const message = messageOf(err).toLowerCase();

  return (
    message.includes('image') ||
    message.includes('unsupported') ||
    message.includes('invalid') ||
    message.includes('corrupt') ||
    message.includes('input buffer')
  );
}
