import sharp from 'sharp';
import { randomUUID } from 'crypto';
import type { ObjectStore } from '../../../../infrastructure/ports/object-store.port';

export interface ImageProcessingInput {
  jobId: string;
  vehicleId: string;
  sourceKey: string;
  displayOrder: number;
  isPrimary: boolean;
}

export interface ImageProcessingOutput {
  vehicleId: string;
  sourceKey: string;
  processedKey: string;
  thumbnailKey: string;
  displayOrder: number;
  isPrimary: boolean;
  width: number;
  height: number;
  sizeBytes: number;
  thumbnailSizeBytes: number;
}

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  quality?: number;
}

const DEFAULTS: Required<ImageProcessingOptions> = {
  maxWidth: 1600,
  maxHeight: 1200,
  thumbnailWidth: 400,
  thumbnailHeight: 300,
  quality: 82,
};

/**
 * B3 - Image Processing Stage.
 *
 * Reads the original image from ObjectStore, processes it using Sharp,
 * creates a thumbnail, and writes both outputs back to ObjectStore.
 *
 * The original dealer upload is never modified.
 */
export async function processVehicleImage(
  objectStore: ObjectStore,
  input: ImageProcessingInput,
  options: ImageProcessingOptions = {},
): Promise<ImageProcessingOutput> {
  const config = {
    ...DEFAULTS,
    ...options,
  };

  if (!input.sourceKey.startsWith(`raw/${input.jobId}/`)) {
    throw new Error(
      `Invalid image source key for job ${input.jobId}: ${input.sourceKey}`,
    );
  }

  const source = await objectStore.get(input.sourceKey);

  if (!source.length) {
    throw new Error(`Image is empty: ${input.sourceKey}`);
  }

  const image = sharp(source, {
    failOn: 'error',
  });

  const metadata = await image.metadata();

  if (!metadata.format) {
    throw new Error(`Unsupported or invalid image: ${input.sourceKey}`);
  }

  const processedBuffer = await sharp(source)
    .rotate()
    .resize({
      width: config.maxWidth,
      height: config.maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: config.quality,
      mozjpeg: true,
    })
    .toBuffer();

  const thumbnailBuffer = await sharp(source)
    .rotate()
    .resize({
      width: config.thumbnailWidth,
      height: config.thumbnailHeight,
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 75,
      mozjpeg: true,
    })
    .toBuffer();

  const processedKey =
    `images/${input.jobId}/${input.vehicleId}/` +
    `${input.displayOrder}-${randomUUID()}.jpg`;

  const thumbnailKey =
    `images/${input.jobId}/${input.vehicleId}/` +
    `${input.displayOrder}-${randomUUID()}-thumb.jpg`;

  await objectStore.put(
    processedKey,
    processedBuffer,
    'image/jpeg',
  );

  await objectStore.put(
    thumbnailKey,
    thumbnailBuffer,
    'image/jpeg',
  );

  const processedMetadata = await sharp(processedBuffer).metadata();

  return {
    vehicleId: input.vehicleId,
    sourceKey: input.sourceKey,
    processedKey,
    thumbnailKey,
    displayOrder: input.displayOrder,
    isPrimary: input.isPrimary,
    width: processedMetadata.width ?? 0,
    height: processedMetadata.height ?? 0,
    sizeBytes: processedBuffer.length,
    thumbnailSizeBytes: thumbnailBuffer.length,
  };
}