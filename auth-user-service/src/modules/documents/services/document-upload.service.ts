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
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  documentServeConfig,
  type DocumentServeConfig,
} from '../../../config/document-serve.config';
import { safeLocalPath } from '../safe-local-path';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export type UploadedDocumentFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/**
 * Stores a single verification document (business registration certificate)
 * uploaded during dealer registration — before the account exists, so there
 * is no userId to key the object on. Keyed by a random upload token instead;
 * the frontend carries the returned key into the actual register-dealer
 * call, which is what ends up persisted in DealerProfile.verificationDocuments.
 *
 * Mirrors marketplace-service's ImageUploadService (storeOne/putS3/putLocal)
 * exactly, just pointed at a separate, private bucket for KYC documents.
 */
@Injectable()
export class DocumentUploadService {
  private readonly logger = new Logger(DocumentUploadService.name);
  private client: S3Client | undefined;

  constructor(private readonly config: ConfigService) {}

  async uploadPending(file: UploadedDocumentFile): Promise<{ key: string }> {
    this.assertUploadable(file);

    const cfg = documentServeConfig(this.config);
    if (cfg.mode === 'demo') {
      throw new BadRequestException(
        'Document upload is not available in demo mode (set DOCUMENT_SERVE_MODE=local or s3)',
      );
    }

    const extension = ALLOWED_MIME_TYPES[file.mimetype];
    const key = `verification/pending/${randomUUID()}.${extension}`;

    if (cfg.mode === 's3') {
      await this.putS3(cfg.bucket, cfg.region, key, file);
    } else {
      await this.putLocal(cfg.root, key, file);
    }

    return { key };
  }

  private assertUploadable(file: UploadedDocumentFile): void {
    if (!(file.mimetype in ALLOWED_MIME_TYPES)) {
      throw new BadRequestException(
        `Unsupported document type: ${file.mimetype} (expected PDF, JPEG or PNG)`,
      );
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `${file.originalname} is too large (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`,
      );
    }
  }

  private async putS3(
    bucket: string,
    region: string,
    key: string,
    file: UploadedDocumentFile,
  ): Promise<void> {
    if (!bucket) {
      throw new InternalServerErrorException(
        'DOCUMENT_SERVE_MODE=s3 but VERIFICATION_DOCS_BUCKET is unset',
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
      throw new InternalServerErrorException('Could not store the document');
    }
  }

  private async putLocal(
    root: string,
    key: string,
    file: UploadedDocumentFile,
  ): Promise<void> {
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
