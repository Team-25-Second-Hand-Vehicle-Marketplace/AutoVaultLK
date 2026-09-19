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

  constructor(private readonly vehicleImages: VehicleImageRepository) {}

  setImageProcessorForTest(processor: ImageProcessor): void {
    this.processor = processor;
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
    const vehicle = await this.vehicleImages.findVehicleByRegistration(
      image.registrationNumber,
      jobId,
    );

    if (!vehicle) {
      this.logger.warn(
        `Skipping image ${image.fileName}: no vehicle for registration ${image.registrationNumber} in job ${jobId}`,
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
