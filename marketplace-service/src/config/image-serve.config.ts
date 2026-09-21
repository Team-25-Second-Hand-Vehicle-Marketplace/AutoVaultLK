import { ConfigService } from '@nestjs/config';

/**
 * How the /listings image endpoints resolve a stored path into something a
 * browser can fetch (NFR-19: "Vehicle images shall not be publicly writable;
 * access shall be via signed URLs").
 *
 *   s3    — production. Presigns a real, time-limited GET URL against
 *           MARKETPLACE_IMAGES_BUCKET. Requires AWS credentials the process
 *           can assume.
 *   local — dev convenience for when images were actually run through the
 *           ETL pipeline locally (INGESTION_STORAGE_DRIVER=local): streams
 *           the file straight from ingestion-service's own storage
 *           directory. No AWS involved, no bucket required.
 *   demo  — dev default. No image is ever resolved from storage; the caller
 *           falls back to the frontend's placeholder photos, exactly as if
 *           this feature did not exist. Safe with an empty vehicle_images
 *           table, which is the actual state of a fresh checkout — nobody
 *           has to configure or even know this exists to keep running the
 *           app the way they always have.
 */
export const IMAGE_SERVE_MODES = ['s3', 'local', 'demo'] as const;
export type ImageServeMode = (typeof IMAGE_SERVE_MODES)[number];

export const DEFAULT_IMAGE_SERVE_MODE: ImageServeMode = 'demo';

export const DEFAULT_PRESIGN_EXPIRY_SECONDS = 300;

/**
 * Must track s3-images/variables.tf's max_presign_expiry_seconds — that file
 * documents the ceiling the Terraform module was built around, and a caller
 * asking for a longer-lived URL here would quietly defeat the reason NFR-19
 * asks for signed URLs in the first place.
 */
const MAX_PRESIGN_EXPIRY_SECONDS = 900;

export type ImageServeConfig =
  | { mode: 's3'; bucket: string; region: string; presignExpirySeconds: number }
  | { mode: 'local'; root: string }
  | { mode: 'demo' };

/**
 * Reads IMAGE_SERVE_MODE and the settings that mode needs.
 *
 * Deliberately does NOT throw for a misconfigured s3/local mode — an image
 * endpoint that 500s because a bucket name is blank is a worse failure than
 * one that falls back to demo photos and logs why. The caller (the images
 * controller/service) is what decides whether a validation problem is worth
 * surfacing at boot vs. per-request; this function only ever returns a
 * config for the mode actually requested, never silently substitutes another.
 */
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
 * ceiling is clamped rather than honoured — the whole point of NFR-19's
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
