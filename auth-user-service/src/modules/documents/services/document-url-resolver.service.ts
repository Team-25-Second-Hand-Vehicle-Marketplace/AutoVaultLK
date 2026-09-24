import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  documentServeConfig,
  type DocumentServeConfig,
} from '../../../config/document-serve.config';

/**
 * Turns a stored verification-document key into something an admin's
 * browser can actually fetch — or null when there is nothing honest to
 * return. Mirrors marketplace-service's ImageUrlResolverService, but the
 * `local` route this points at must be admin-authenticated (see
 * documents.controller.ts): unlike vehicle images, these are sensitive KYC
 * documents, not public catalogue data.
 */
@Injectable()
export class DocumentUrlResolverService {
  private readonly logger = new Logger(DocumentUrlResolverService.name);
  private client: S3Client | undefined;
  private warnedMissingBucket = false;

  constructor(private readonly config: ConfigService) {}

  async resolve(key: string | null | undefined): Promise<string | null> {
    if (!key) return null;

    const cfg = documentServeConfig(this.config);

    switch (cfg.mode) {
      case 'demo':
        return null;
      case 'local':
        return this.resolveLocal(key);
      case 's3':
        return this.resolveS3(key, cfg);
    }
  }

  private resolveLocal(key: string): string {
    return `/documents/local/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  private async resolveS3(
    key: string,
    cfg: Extract<DocumentServeConfig, { mode: 's3' }>,
  ): Promise<string | null> {
    if (!cfg.bucket) {
      if (!this.warnedMissingBucket) {
        this.logger.warn(
          'DOCUMENT_SERVE_MODE=s3 but VERIFICATION_DOCS_BUCKET is unset; documents will not resolve',
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
