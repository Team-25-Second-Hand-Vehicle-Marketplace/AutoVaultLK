import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { documentServeConfig } from '../../../config/document-serve.config';

/**
 * Turns a stored verification-document key (DealerProfileView.verificationDocuments)
 * into a URL an admin can open to review it. Only resolves in `s3` mode —
 * admin-service doesn't own the local filesystem auth-user-service writes to
 * in `local` mode, so an admin reviewing locally just sees no link, the same
 * "nothing to show" fallback marketplace-service's image resolver uses for
 * `demo` mode.
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
    if (cfg.mode !== 's3') return null;

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
