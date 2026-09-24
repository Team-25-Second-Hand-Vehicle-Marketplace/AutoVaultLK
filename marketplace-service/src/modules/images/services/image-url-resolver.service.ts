import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  imageServeConfig,
  type ImageServeConfig,
} from '../../../config/image-serve.config';

/**
 * Turns a stored object key (`images/{jobId}/{vehicleId}/0-x.jpg`, as written
 * by ingestion-service's image-processing stage) into something a browser can
 * actually fetch — or into nothing, deliberately, when there is nothing
 * honest to return.
 *
 * NFR-19: "Vehicle images shall not be publicly writable; access shall be
 * via signed URLs." Before this existed, vehicle-search.repository.ts and
 * recommendations.repository.ts handed the raw key straight to the frontend
 * as `imageUrl`, which an <img src> cannot resolve — see FR-Traceability's
 * "Empty until image upload is wired up" note on the DTO.
 *
 * **`s3` mode signs locally.** `getSignedUrl` computes a SigV4 signature —
 * it never calls AWS. That is what makes it safe to call once per image on
 * every search result row: it costs a small amount of CPU, not a network
 * round trip, so resolving 20 rows' worth of images inline in a search
 * response is not 20 API calls.
 */
@Injectable()
export class ImageUrlResolverService {
  private readonly logger = new Logger(ImageUrlResolverService.name);
  private client: S3Client | undefined;
  private warnedMissingBucket = false;

  constructor(private readonly config: ConfigService) {}

  /**
   * Resolves one stored key, or passes through `null` unchanged — a vehicle
   * with no image is not an error at any layer, all the way out to the
   * frontend's own placeholder fallback (VehicleCard.tsx already does
   * `imageUrl ?? demoImageFor(...)`, so returning null here is what makes
   * that fallback trigger instead of the caller inventing a broken link).
   */
  async resolve(key: string | null): Promise<string | null> {
    if (!key) return null;

    const cfg = imageServeConfig(this.config);

    switch (cfg.mode) {
      case 'demo':
        // Deliberately not "return key" — an un-presigned S3 key or a raw
        // filesystem path is not a URL a browser can fetch either way, and
        // returning it here would be a *worse* failure than null: an <img>
        // that visibly 404s instead of falling back to a placeholder photo.
        return null;
      case 'local':
        return this.resolveLocal(key);
      case 's3':
        return this.resolveS3(key, cfg);
    }
  }

  /** Resolves every key in a list, dropping (not nulling) entries with nothing to show. */
  async resolveAll(keys: readonly string[]): Promise<string[]> {
    const resolved = await Promise.all(keys.map((key) => this.resolve(key)));
    return resolved.filter((url): url is string => url !== null);
  }

  /**
   * Points at the streaming route this module's controller exposes — see
   * images.controller.ts, which reads MARKETPLACE_IMAGES_LOCAL_ROOT itself
   * rather than this service needing it. Encoded because a dealer-supplied
   * filename (sanitizeKeyPart aside) can still contain characters a raw path
   * segment would mangle.
   */
  private resolveLocal(key: string): string {
    return `/images/local/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async resolveS3(
    key: string,
    cfg: Extract<ImageServeConfig, { mode: 's3' }>,
  ): Promise<string | null> {
    if (!cfg.bucket) {
      // Logged once per process rather than once per request — a missing
      // bucket name is a deployment misconfiguration, not a per-row event,
      // and a search response returning 20 identical warnings would drown
      // out everything else in the log.
      if (!this.warnedMissingBucket) {
        this.logger.warn(
          'IMAGE_SERVE_MODE=s3 but MARKETPLACE_IMAGES_BUCKET is unset; images will not resolve',
        );
        this.warnedMissingBucket = true;
      }
      return null;
    }

    try {
      const client = this.getClient(cfg.region);
      const command = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
      return await getSignedUrl(client, command, {
        expiresIn: cfg.presignExpirySeconds,
      });
    } catch (err) {
      // A presign failure (bad credentials, SDK misconfiguration) must not
      // fail the whole search response — one vehicle photo among twenty
      // failing to sign should degrade to that one card's placeholder, not
      // a 500 for every dealer's listing.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to presign ${key}: ${message}`);
      return null;
    }
  }

  private getClient(region: string): S3Client {
    if (!this.client) {
      this.client = new S3Client({ region });
    }
    return this.client;
  }
}
