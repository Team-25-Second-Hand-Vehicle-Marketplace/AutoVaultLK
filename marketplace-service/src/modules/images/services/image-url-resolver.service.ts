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
 * actually fetch - or into nothing, deliberately, when there is nothing
 * honest to return.
 *
 * NFR-19: "Vehicle images shall not be publicly writable; access shall be
 * via signed URLs." Before this existed, vehicle-search.repository.ts and
 * recommendations.repository.ts handed the raw key straight to the frontend
 * as `imageUrl`, which an <img src> cannot resolve - see FR-Traceability's
 * "Empty until image upload is wired up" note on the DTO.
 *
 * **`s3` mode signs locally.** `getSignedUrl` computes a SigV4 signature -
 * it never calls AWS. That is what makes it safe to call once per image on
 * every search result row: it costs a small amount of CPU, not a network
 * round trip, so resolving 20 rows' worth of images inline in a search
 * response is not 20 API calls.
 *
 * **Signed URLs are cached per key, not re-minted every call.** Without this,
 * the same photo got a brand-new query string (new signature) on every
 * request, so even reloading the same dashboard a minute later produced a
 * byte-identical image at a different URL - the browser's HTTP cache keys on
 * the full URL, so it could never recognize "I already have this" and
 * re-fetched every image, every time. Caching the signed URL for most of its
 * validity window (with a safety margin so a client never receives one about
 * to expire mid-fetch) lets the same <img src> repeat across requests, so the
 * browser's own cache - backed by the Cache-Control this now also sends -
 * actually gets to do its job.
 */
@Injectable()
export class ImageUrlResolverService {
  private readonly logger = new Logger(ImageUrlResolverService.name);
  private client: S3Client | undefined;
  private warnedMissingBucket = false;
  private readonly signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

  /** Regenerate this long before actual expiry, so a cached URL never gets handed to a client moments before S3 would start rejecting it. */
  private static readonly EXPIRY_SAFETY_MARGIN_SECONDS = 30;

  constructor(private readonly config: ConfigService) {}

  /**
   * Resolves one stored key, or passes through `null` unchanged - a vehicle
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
        // Deliberately not "return key" - an un-presigned S3 key or a raw
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
   * Points at the streaming route this module's controller exposes - see
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
      // Logged once per process rather than once per request - a missing
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

    const cached = this.signedUrlCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const usableSeconds = Math.max(
      cfg.presignExpirySeconds - ImageUrlResolverService.EXPIRY_SAFETY_MARGIN_SECONDS,
      1,
    );

    try {
      const client = this.getClient(cfg.region);
      const command = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        // Tells the browser (and anything between it and S3) it may reuse
        // this response for as long as this specific signed URL stays valid
        // - without it, S3's response carries no explicit cache lifetime, so
        // browsers fall back to weaker heuristic caching.
        ResponseCacheControl: `public, max-age=${usableSeconds}, immutable`,
      });
      const url = await getSignedUrl(client, command, {
        expiresIn: cfg.presignExpirySeconds,
      });
      this.signedUrlCache.set(key, {
        url,
        expiresAt: Date.now() + usableSeconds * 1000,
      });
      return url;
    } catch (err) {
      // A presign failure (bad credentials, SDK misconfiguration) must not
      // fail the whole search response - one vehicle photo among twenty
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
