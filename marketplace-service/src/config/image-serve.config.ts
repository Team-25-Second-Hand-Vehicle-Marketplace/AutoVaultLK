import { ConfigService } from '@nestjs/config';

export const IMAGE_SERVE_MODES = ['s3', 'local', 'demo'] as const;
export type ImageServeMode = (typeof IMAGE_SERVE_MODES)[number];

export const DEFAULT_IMAGE_SERVE_MODE: ImageServeMode = 'demo';

export const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;

/**
 * Must track s3-images/variables.tf's max_presign_expiry_seconds - that file
 * documents the ceiling the Terraform module was built around, and a caller
 * asking for a longer-lived URL here would quietly defeat the reason NFR-19
 * asks for signed URLs in the first place.
 */
const MAX_PRESIGN_EXPIRY_SECONDS = 900;

export type ImageServeConfig =
  | { mode: 's3'; bucket: string; region: string; presignExpirySeconds: number }
  | { mode: 'local'; root: string }
  | { mode: 'demo' };

export function imageServeConfig(config: ConfigService): ImageServeConfig {
  const raw = config.get<string>('IMAGE_SERVE_MODE')?.trim();
  const mode = isImageServeMode(raw) ? raw : DEFAULT_IMAGE_SERVE_MODE;

  switch (mode) {
    case 's3':
      return {
        mode: 's3',
        bucket: config.get<string>('MARKETPLACE_IMAGES_BUCKET')?.trim() ?? '',
        region: config.get<string>('AWS_REGION')?.trim() || 'ap-southeast-1',
        presignExpirySeconds: clampedPresignExpiry(config),
      };
    case 'local':
      return {
        mode: 'local',
        root:
          config.get<string>('MARKETPLACE_IMAGES_LOCAL_ROOT')?.trim() ||
          '../ingestion-service/.storage',
      };
    case 'demo':
      return { mode: 'demo' };
  }
}

function isImageServeMode(value: string | undefined): value is ImageServeMode {
  return (IMAGE_SERVE_MODES as readonly string[]).includes(value ?? '');
}

/**
 * A caller-requested expiry longer than the bucket module's documented
 * ceiling is clamped rather than honoured - the whole point of NFR-19's
 * signed-URL requirement is that a link stops working soon, and a
 * misconfigured env var should not silently turn that into a link that
 * works for a day.
 */
function clampedPresignExpiry(config: ConfigService): number {
  const parsed = Number.parseInt(
    config.get<string>('IMAGE_PRESIGN_EXPIRY_SECONDS') ?? '',
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0)
    return DEFAULT_PRESIGN_EXPIRY_SECONDS;
  return Math.min(parsed, MAX_PRESIGN_EXPIRY_SECONDS);
}
