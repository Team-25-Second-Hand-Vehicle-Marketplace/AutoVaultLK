import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Repository } from 'typeorm';
import {
  imageServeConfig,
  type ImageServeConfig,
} from '../../../config/image-serve.config';
import { VehicleImage } from '../../../infrastructure/database/entities/vehicle-image.entity';
import { safeLocalPath } from '../safe-local-path';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Matches ingestion-service's per-image size expectation for a dealer photo. */
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB

/** A single listing rarely needs more than this to show a buyer the vehicle. */
const MAX_FILES_PER_UPLOAD = 10;

export type UploadedImageFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/**
 * FR-58's manual listing path never had an image field — a dealer creating
 * one vehicle at a time (as opposed to bulk upload) had no way to attach a
 * photo at all. This is the write side; ImageUrlResolverService is the read
 * side that turns what gets stored here back into something a browser can
 * fetch.
 *
 * Writes under `images/manual/{vehicleId}/...` — a distinct prefix from
 * ingestion's `images/{jobId}/{vehicleId}/...` (image-processing.stage.ts),
 * so a manual upload and a bulk-pipeline upload for the same vehicle can
 * never collide on the same key, and s3-images/main.tf's lifecycle rule
 * (which only touches `staging/`) leaves this alone exactly like it leaves
 * the pipeline's own `images/` prefix alone.
 *
 * No Sharp resize/compress here, unlike the ETL pipeline's image-processing
 * stage — a dealer uploading one photo at a time through a web form is a
 * different cost profile than a bulk job processing hundreds, and adding
 * that dependency to marketplace-service for a handful of manual uploads a
 * day is not a trade this endpoint needs to make. Revisit if upload volume
 * or storage cost ever makes it worth it.
 */
@Injectable()
export class ImageUploadService {
  private readonly logger = new Logger(ImageUploadService.name);
  private client: S3Client | undefined;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(VehicleImage)
    private readonly imageRepo: Repository<VehicleImage>,
  ) {}

  /**
   * Validates and stores every file, then records them as one batch —
   * replacing whatever images the vehicle already had, since a dealer
   * re-submitting the photo set for a listing means "this is the current
   * set", not "add more to what's there".
   */
  async replaceImages(
    vehicleId: string,
    files: UploadedImageFile[],
  ): Promise<VehicleImage[]> {
    this.assertUploadable(files);

    const cfg = imageServeConfig(this.config);
    if (cfg.mode === 'demo') {
      // demo mode exists so a fresh checkout works with zero setup; actually
      // accepting an upload it can never serve back would be a worse
      // failure than a clear 400 telling the dealer (or, in practice, the
      // developer testing this locally) what to change.
      throw new BadRequestException(
        'Image upload is not available in demo mode (set IMAGE_SERVE_MODE=local or s3)',
      );
    }

    const stored = await Promise.all(
      files.map((file, index) => this.storeOne(cfg, vehicleId, file, index)),
    );

    await this.imageRepo.delete({ vehicleId });

    const rows = stored.map((s, index) =>
      this.imageRepo.create({
        vehicleId,
        s3Path: s.key,
        processedPath: null,
        thumbnailPath: null,
        isPrimary: index === 0,
        displayOrder: index,
      }),
    );

    return this.imageRepo.save(rows);
  }

  private assertUploadable(files: UploadedImageFile[]): void {
    if (files.length === 0) {
      throw new BadRequestException('At least one image is required');
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      throw new BadRequestException(
        `At most ${MAX_FILES_PER_UPLOAD} images per listing`,
      );
    }
    for (const file of files) {
      if (!(file.mimetype in ALLOWED_MIME_TYPES)) {
        throw new BadRequestException(
          `Unsupported image type: ${file.mimetype} (expected JPEG, PNG or WebP)`,
        );
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new BadRequestException(
          `${file.originalname} is too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`,
        );
      }
    }
  }

  /**
   * Takes the narrowed union (never `demo`) explicitly, rather than the full
   * ImageServeConfig — replaceImages already threw before reaching this for
   * demo mode, and re-widening the type here would silently let a future
   * caller pass an unhandled mode straight through to the `else` branch
   * below with no compiler error to catch it.
   */
  private async storeOne(
    cfg: Exclude<ImageServeConfig, { mode: 'demo' }>,
    vehicleId: string,
    file: UploadedImageFile,
    index: number,
  ): Promise<{ key: string }> {
    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    const key = `images/manual/${vehicleId}/${index}-${randomUUID()}.${extension}`;

    if (cfg.mode === 's3') {
      await this.putS3(cfg.bucket, cfg.region, key, file);
    } else {
      await this.putLocal(cfg.root, key, file);
    }

    return { key };
  }

  private async putS3(
    bucket: string,
    region: string,
    key: string,
    file: UploadedImageFile,
  ): Promise<void> {
    if (!bucket) {
      throw new InternalServerErrorException(
        'IMAGE_SERVE_MODE=s3 but MARKETPLACE_IMAGES_BUCKET is unset',
      );
    }

    try {
      const client = this.getClient(region);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to upload ${key} to S3: ${message}`);
      throw new InternalServerErrorException('Could not store the image');
    }
  }

  private async putLocal(
    root: string,
    key: string,
    file: UploadedImageFile,
  ): Promise<void> {
    // safeLocalPath rejects a traversal attempt the same way
    // LocalImagesController's read side does — the key here is built from a
    // server-generated UUID, not user input, so it can never actually
    // trigger that guard, but the call stays rather than assuming so.
    const path = safeLocalPath(root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.buffer);
  }

  private getClient(region: string): S3Client {
    if (!this.client) {
      this.client = new S3Client({ region });
    }
    return this.client;
  }
}
