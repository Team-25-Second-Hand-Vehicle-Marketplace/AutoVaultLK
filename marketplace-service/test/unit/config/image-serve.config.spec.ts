import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_IMAGE_SERVE_MODE,
  DEFAULT_PRESIGN_EXPIRY_SECONDS,
  imageServeConfig,
} from '../../../src/config/image-serve.config';

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/**
 * NFR-19: images are served via signed URLs, never a public bucket. This is
 * the toggle behind that — s3 for production, local/demo so a fresh
 * checkout with no AWS credentials and an empty vehicle_images table still
 * runs, per the fallback-mode requirement.
 */
describe('imageServeConfig', () => {
  it('defaults to demo mode when IMAGE_SERVE_MODE is unset', () => {
    expect(imageServeConfig(configWith({}))).toEqual({ mode: 'demo' });
    expect(DEFAULT_IMAGE_SERVE_MODE).toBe('demo');
  });

  // A typo in the env var must not silently turn into "s3 mode with an
  // empty bucket name" — that would 500 or hang on every request instead of
  // falling back to the safe default.
  it('falls back to demo for an unrecognised mode value', () => {
    expect(imageServeConfig(configWith({ IMAGE_SERVE_MODE: 'S3' }))).toEqual({
      mode: 'demo',
    });
    expect(
      imageServeConfig(configWith({ IMAGE_SERVE_MODE: 'production' })),
    ).toEqual({
      mode: 'demo',
    });
  });

  describe('s3 mode', () => {
    it('reads the bucket and region', () => {
      expect(
        imageServeConfig(
          configWith({
            IMAGE_SERVE_MODE: 's3',
            MARKETPLACE_IMAGES_BUCKET: 'vehicle-marketplace-images-production',
            AWS_REGION: 'ap-southeast-2',
          }),
        ),
      ).toEqual({
        mode: 's3',
        bucket: 'vehicle-marketplace-images-production',
        region: 'ap-southeast-2',
        presignExpirySeconds: DEFAULT_PRESIGN_EXPIRY_SECONDS,
      });
    });

    it('defaults the region when AWS_REGION is unset', () => {
      const result = imageServeConfig(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'bucket',
        }),
      );
      expect(result).toMatchObject({ region: 'ap-southeast-1' });
    });

    // A blank bucket is a real misconfiguration, but it is the images
    // service's job to react to that (fail the request, log a warning) —
    // this function's job is only to report what was configured.
    it('returns an empty bucket name rather than throwing when unset', () => {
      expect(
        imageServeConfig(configWith({ IMAGE_SERVE_MODE: 's3' })),
      ).toMatchObject({ mode: 's3', bucket: '' });
    });

    it('reads a configured presign expiry', () => {
      expect(
        imageServeConfig(
          configWith({
            IMAGE_SERVE_MODE: 's3',
            MARKETPLACE_IMAGES_BUCKET: 'bucket',
            IMAGE_PRESIGN_EXPIRY_SECONDS: '120',
          }),
        ),
      ).toMatchObject({ presignExpirySeconds: 120 });
    });

    // Must track s3-images/variables.tf's max_presign_expiry_seconds (900).
    // A longer-lived link would quietly defeat NFR-19's "signed URLs expire
    // soon" intent.
    it('clamps an oversized presign expiry to the documented ceiling', () => {
      expect(
        imageServeConfig(
          configWith({
            IMAGE_SERVE_MODE: 's3',
            MARKETPLACE_IMAGES_BUCKET: 'bucket',
            IMAGE_PRESIGN_EXPIRY_SECONDS: '86400',
          }),
        ),
      ).toMatchObject({ presignExpirySeconds: 900 });
    });

    it.each(['0', '-5', 'not-a-number', ''])(
      'falls back to the default expiry for %s',
      (value) => {
        expect(
          imageServeConfig(
            configWith({
              IMAGE_SERVE_MODE: 's3',
              MARKETPLACE_IMAGES_BUCKET: 'bucket',
              IMAGE_PRESIGN_EXPIRY_SECONDS: value,
            }),
          ),
        ).toMatchObject({
          presignExpirySeconds: DEFAULT_PRESIGN_EXPIRY_SECONDS,
        });
      },
    );
  });

  describe('local mode', () => {
    it('reads the configured local root', () => {
      expect(
        imageServeConfig(
          configWith({
            IMAGE_SERVE_MODE: 'local',
            MARKETPLACE_IMAGES_LOCAL_ROOT: '/tmp/ingestion-storage',
          }),
        ),
      ).toEqual({ mode: 'local', root: '/tmp/ingestion-storage' });
    });

    // Matches ingestion-service's own INGESTION_STORAGE_ROOT default
    // (.storage), so a docker-compose checkout with neither variable set
    // still points marketplace at where ingestion actually wrote the files.
    it('defaults to the sibling ingestion-service storage directory', () => {
      expect(
        imageServeConfig(configWith({ IMAGE_SERVE_MODE: 'local' })),
      ).toEqual({
        mode: 'local',
        root: '../ingestion-service/.storage',
      });
    });
  });

  describe('demo mode', () => {
    it('carries no other configuration', () => {
      expect(
        imageServeConfig(configWith({ IMAGE_SERVE_MODE: 'demo' })),
      ).toEqual({
        mode: 'demo',
      });
    });
  });
});
