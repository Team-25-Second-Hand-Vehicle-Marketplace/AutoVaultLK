import type { ConfigService } from '@nestjs/config';
import { ImageUrlResolverService } from '../../../../src/modules/images/services/image-url-resolver.service';

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  GetObjectCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

const getSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]): unknown => getSignedUrl(...args),
}));

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/**
 * NFR-19: "Vehicle images shall not be publicly writable; access shall be
 * via signed URLs." What this guards is that every mode resolves a stored
 * key into something a browser can actually fetch — or, deliberately,
 * into nothing at all when there is nothing honest to return — rather than
 * handing the raw storage key straight through as if it were a URL (the
 * defect this whole module exists to fix).
 */
describe('ImageUrlResolverService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes a null key through as null in every mode', async () => {
    for (const mode of ['s3', 'local', 'demo']) {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: mode }),
      );
      await expect(resolver.resolve(null)).resolves.toBeNull();
    }
  });

  describe('demo mode', () => {
    it('returns null for a key that exists in storage', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'demo' }),
      );

      await expect(
        resolver.resolve('images/job-1/veh-1/0-x.jpg'),
      ).resolves.toBeNull();
    });

    it('is the default when IMAGE_SERVE_MODE is unset', async () => {
      const resolver = new ImageUrlResolverService(configWith({}));

      await expect(
        resolver.resolve('images/job-1/veh-1/0-x.jpg'),
      ).resolves.toBeNull();
    });

    it('is the fallback for an unrecognised mode value', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'production' }),
      );

      await expect(
        resolver.resolve('images/job-1/veh-1/0-x.jpg'),
      ).resolves.toBeNull();
    });
  });

  describe('local mode', () => {
    it("builds a route into this service's own streaming controller", async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'local' }),
      );

      await expect(
        resolver.resolve('images/job-1/veh-1/0-x.jpg'),
      ).resolves.toBe('/images/local/images/job-1/veh-1/0-x.jpg');
    });

    it('percent-encodes each path segment', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'local' }),
      );

      await expect(
        resolver.resolve('images/job 1/veh#1/0 x.jpg'),
      ).resolves.toBe('/images/local/images/job%201/veh%231/0%20x.jpg');
    });

    it('never calls out to S3', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'local' }),
      );

      await resolver.resolve('images/job-1/veh-1/0-x.jpg');

      expect(send).not.toHaveBeenCalled();
      expect(getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('s3 mode', () => {
    it('presigns without ever calling AWS (S3Client.send is never invoked)', async () => {
      getSignedUrl.mockResolvedValue(
        'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc',
      );
      const resolver = new ImageUrlResolverService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'my-bucket',
        }),
      );

      const url = await resolver.resolve('images/job-1/veh-1/0-x.jpg');

      expect(url).toBe(
        'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc',
      );
      // getSignedUrl computes a local SigV4 signature; it never opens a
      // connection to AWS the way GetObjectCommand's `send` would.
      expect(send).not.toHaveBeenCalled();
    });

    it('signs against the configured bucket and key', async () => {
      getSignedUrl.mockResolvedValue('https://signed');
      const resolver = new ImageUrlResolverService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'my-bucket',
        }),
      );

      await resolver.resolve('images/job-1/veh-1/0-x.jpg');

      const [, command, options] = getSignedUrl.mock.calls[0] as [
        unknown,
        { input: Record<string, unknown> },
        { expiresIn: number },
      ];
      expect(command.input).toEqual({
        Bucket: 'my-bucket',
        Key: 'images/job-1/veh-1/0-x.jpg',
      });
      expect(options.expiresIn).toBe(300); // DEFAULT_PRESIGN_EXPIRY_SECONDS
    });

    it('honours a configured presign expiry', async () => {
      getSignedUrl.mockResolvedValue('https://signed');
      const resolver = new ImageUrlResolverService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'my-bucket',
          IMAGE_PRESIGN_EXPIRY_SECONDS: '60',
        }),
      );

      await resolver.resolve('images/job-1/veh-1/0-x.jpg');

      const [, , options] = getSignedUrl.mock.calls[0] as [
        unknown,
        unknown,
        { expiresIn: number },
      ];
      expect(options.expiresIn).toBe(60);
    });

    // A missing bucket is a real deployment misconfiguration, not a reason
    // to 500 a search response — the whole page should still render, with
    // this vehicle's card falling back to the frontend's placeholder.
    it('returns null rather than throwing when the bucket is unset', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 's3' }),
      );

      await expect(
        resolver.resolve('images/job-1/veh-1/0-x.jpg'),
      ).resolves.toBeNull();
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('returns null when presigning throws, rather than rejecting', async () => {
      getSignedUrl.mockRejectedValue(new Error('credentials not found'));
      const resolver = new ImageUrlResolverService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'my-bucket',
        }),
      );

      await expect(
        resolver.resolve('images/job-1/veh-1/0-x.jpg'),
      ).resolves.toBeNull();
    });

    it('reuses one S3Client across repeated calls', async () => {
      const { S3Client } = jest.requireMock(
        '@aws-sdk/client-s3',
      ) as unknown as {
        S3Client: jest.Mock;
      };
      getSignedUrl.mockResolvedValue('https://signed');
      const resolver = new ImageUrlResolverService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'my-bucket',
        }),
      );

      await resolver.resolve('a.jpg');
      await resolver.resolve('b.jpg');

      expect(S3Client).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveAll', () => {
    it('drops entries with nothing to show rather than keeping them as null', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'local' }),
      );

      const urls = await resolver.resolveAll([
        'images/job-1/a.jpg',
        'images/job-1/b.jpg',
      ]);

      expect(urls).toEqual([
        '/images/local/images/job-1/a.jpg',
        '/images/local/images/job-1/b.jpg',
      ]);
    });

    it('resolves an empty list to an empty list', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 's3' }),
      );

      await expect(resolver.resolveAll([])).resolves.toEqual([]);
    });

    it('filters out demo-mode nulls from a mixed list', async () => {
      const resolver = new ImageUrlResolverService(
        configWith({ IMAGE_SERVE_MODE: 'demo' }),
      );

      await expect(
        resolver.resolveAll(['images/job-1/a.jpg', 'images/job-1/b.jpg']),
      ).resolves.toEqual([]);
    });
  });
});
