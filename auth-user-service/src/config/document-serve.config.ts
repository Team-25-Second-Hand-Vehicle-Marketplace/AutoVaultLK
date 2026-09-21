import { ConfigService } from '@nestjs/config';

/**
 * How the verification-document endpoints store and resolve an uploaded
 * file. Mirrors marketplace-service's image-serve.config.ts exactly — same
 * three modes, same reasoning — but for a separate, private bucket: NIC
 * scans and business registration certificates are sensitive KYC documents,
 * not public-ish vehicle photos, so they get their own bucket and IAM roles
 * (see cloud-infrastructure/terraform's s3-images module, reused here as a
 * second instance) rather than sharing the vehicle-images bucket.
 *
 *   s3    — production. Presigns a real, time-limited GET URL against
 *           VERIFICATION_DOCS_BUCKET. Requires AWS credentials the process
 *           can assume.
 *   local — dev convenience: writes/reads under VERIFICATION_DOCS_LOCAL_ROOT
 *           on this machine's own filesystem. No AWS involved.
 *   demo  — dev default. Upload is refused outright (there is nowhere to
 *           put the file); a fresh checkout works with zero setup as long
 *           as nobody tries to register a dealer with a real document yet.
 */
export const DOCUMENT_SERVE_MODES = ['s3', 'local', 'demo'] as const;
export type DocumentServeMode = (typeof DOCUMENT_SERVE_MODES)[number];

export const DEFAULT_DOCUMENT_SERVE_MODE: DocumentServeMode = 'demo';

export const DEFAULT_DOCUMENT_PRESIGN_EXPIRY_SECONDS = 300;

/** Matches s3-images/variables.tf's documented ceiling — see image-serve.config.ts's identical note. */
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
          '.storage/verification-documents',
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
