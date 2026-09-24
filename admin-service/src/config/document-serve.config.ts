import { ConfigService } from '@nestjs/config';

/**
 * How admin-service resolves a stored verification-document key
 * (DealerProfileView.verificationDocuments) into a URL an admin's browser
 * can fetch. Mirrors auth-user-service's config of the same name exactly —
 * duplicated rather than shared because these are separate deployables, the
 * same reason marketplace-service and auth-user-service each carry their own
 * copy of the equivalent image-serving config.
 *
 * Read-only here: admin-service only ever resolves a document to a URL,
 * never uploads one (that's auth-user-service's DocumentUploadService, used
 * during dealer registration before the account exists).
 */
export const DOCUMENT_SERVE_MODES = ['s3', 'local', 'demo'] as const;
export type DocumentServeMode = (typeof DOCUMENT_SERVE_MODES)[number];

export const DEFAULT_DOCUMENT_SERVE_MODE: DocumentServeMode = 'demo';

export const DEFAULT_DOCUMENT_PRESIGN_EXPIRY_SECONDS = 300;

const MAX_PRESIGN_EXPIRY_SECONDS = 900;

export type DocumentServeConfig =
  | { mode: 's3'; bucket: string; region: string; presignExpirySeconds: number }
  | { mode: 'local'; root: string }
  | { mode: 'demo' };

export function documentServeConfig(config: ConfigService): DocumentServeConfig {
  const raw = config.get<string>('DOCUMENT_SERVE_MODE')?.trim();
  const mode = isDocumentServeMode(raw) ? raw : DEFAULT_DOCUMENT_SERVE_MODE;

  switch (mode) {
    case 's3':
      return {
        mode: 's3',
        bucket: config.get<string>('VERIFICATION_DOCS_BUCKET')?.trim() ?? '',
        region: config.get<string>('AWS_REGION')?.trim() || 'ap-southeast-1',
        presignExpirySeconds: clampedPresignExpiry(config),
      };
    case 'local':
      return {
        mode: 'local',
        root:
          config.get<string>('VERIFICATION_DOCS_LOCAL_ROOT')?.trim() ||
          '../auth-user-service/.storage/verification-documents',
      };
    case 'demo':
      return { mode: 'demo' };
  }
}

function isDocumentServeMode(value: string | undefined): value is DocumentServeMode {
  return (DOCUMENT_SERVE_MODES as readonly string[]).includes(value ?? '');
}

function clampedPresignExpiry(config: ConfigService): number {
  const parsed = Number.parseInt(
    config.get<string>('DOCUMENT_PRESIGN_EXPIRY_SECONDS') ?? '',
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0)
    return DEFAULT_DOCUMENT_PRESIGN_EXPIRY_SECONDS;
  return Math.min(parsed, MAX_PRESIGN_EXPIRY_SECONDS);
}
