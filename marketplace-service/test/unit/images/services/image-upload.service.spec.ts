import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ImageUploadService,
  type UploadedImageFile,
} from '../../../../src/modules/images/services/image-upload.service';

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const file = (
  overrides: Partial<UploadedImageFile> = {},
): UploadedImageFile => ({
  originalname: 'front.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  buffer: Buffer.from('jpeg-bytes'),
  ...overrides,
});

/**
 * FR-58: the manual listing form never had an image field before this. What
 * these guard is validation (a dealer must get a clear 400, not a stray
 * server error, for a bad file), the demo-mode refusal (uploads must not
 * silently disappear into a mode that can never serve them back), and that
 * a re-upload replaces the vehicle's image set rather than appending stale
 * photos from an earlier attempt.
 */
describe('ImageUploadService', () => {
  const imageRepo = {
    delete: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn((rows: unknown[]) => Promise.resolve(rows)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    imageRepo.delete.mockResolvedValue(undefined);
  });

  describe('validation', () => {
    const service = () =>
      new ImageUploadService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'bucket',
        }),
        imageRepo as never,
      );

    it('rejects an empty file list', async () => {
      await expect(service().replaceImages('v-1', [])).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects more than 10 files', async () => {
      const files = Array.from({ length: 11 }, () => file());

      await expect(
        service().replaceImages('v-1', files),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts exactly 10 files', async () => {
      send.mockResolvedValue({});
      const files = Array.from({ length: 10 }, () => file());

      await expect(
        service().replaceImages('v-1', files),
      ).resolves.toBeDefined();
    });

    it.each(['image/gif', 'application/pdf', 'text/csv'])(
      'rejects an unsupported mime type: %s',
      async (mimetype) => {
        await expect(
          service().replaceImages('v-1', [file({ mimetype })]),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it.each(['image/jpeg', 'image/png', 'image/webp'])(
      'accepts %s',
      async (mimetype) => {
        send.mockResolvedValue({});

        await expect(
          service().replaceImages('v-1', [file({ mimetype })]),
        ).resolves.toBeDefined();
      },
    );

    it('rejects a file over the size limit', async () => {
      await expect(
        service().replaceImages('v-1', [file({ size: 9 * 1024 * 1024 })]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('names the offending file in the size-limit error', async () => {
      await expect(
        service().replaceImages('v-1', [
          file({ originalname: 'huge.jpg', size: 9 * 1024 * 1024 }),
        ]),
      ).rejects.toThrow(/huge\.jpg/);
    });

    it('does not touch the database when validation fails', async () => {
      await expect(service().replaceImages('v-1', [])).rejects.toThrow();

      expect(imageRepo.delete).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('demo mode', () => {
    it('refuses the upload rather than accepting bytes it can never serve back', async () => {
      const service = new ImageUploadService(
        configWith({ IMAGE_SERVE_MODE: 'demo' }),
        imageRepo as never,
      );

      await expect(
        service.replaceImages('v-1', [file()]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(imageRepo.delete).not.toHaveBeenCalled();
    });

    it('is the default when IMAGE_SERVE_MODE is unset', async () => {
      const service = new ImageUploadService(
        configWith({}),
        imageRepo as never,
      );

      await expect(
        service.replaceImages('v-1', [file()]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('s3 mode', () => {
    const service = () =>
      new ImageUploadService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'my-bucket',
        }),
        imageRepo as never,
      );

    it('puts each file to the configured bucket', async () => {
      send.mockResolvedValue({});

      await service().replaceImages('v-1', [
        file(),
        file({ originalname: 'side.jpg' }),
      ]);

      expect(send).toHaveBeenCalledTimes(2);
    });

    it('keys objects under images/manual/{vehicleId}/', async () => {
      send.mockResolvedValue({});

      await service().replaceImages('v-1', [file()]);

      const [command] = send.mock.calls[0] as [
        { input: Record<string, unknown> },
      ];
      expect(command.input.Bucket).toBe('my-bucket');
      expect(command.input.Key).toMatch(
        /^images\/manual\/v-1\/0-[0-9a-f-]+\.jpg$/,
      );
    });

    it('sets the content type from the file mimetype', async () => {
      send.mockResolvedValue({});

      await service().replaceImages('v-1', [file({ mimetype: 'image/png' })]);

      const [command] = send.mock.calls[0] as [
        { input: Record<string, unknown> },
      ];
      expect(command.input.ContentType).toBe('image/png');
      expect(command.input.Key).toMatch(/\.png$/);
    });

    it('raises a 500 when the bucket is unset despite s3 mode', async () => {
      const service = new ImageUploadService(
        configWith({ IMAGE_SERVE_MODE: 's3' }),
        imageRepo as never,
      );

      await expect(
        service.replaceImages('v-1', [file()]),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('raises a 500 rather than leaking the SDK error when the upload fails', async () => {
      send.mockRejectedValue(new Error('AccessDenied: no such bucket'));

      await expect(
        service().replaceImages('v-1', [file()]),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('local mode', () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'marketplace-upload-'));
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const service = () =>
      new ImageUploadService(
        configWith({
          IMAGE_SERVE_MODE: 'local',
          MARKETPLACE_IMAGES_LOCAL_ROOT: root,
        }),
        imageRepo as never,
      );

    it('writes the file bytes to disk under the configured root', async () => {
      const rows = await service().replaceImages('v-1', [file()]);

      const key = (rows[0] as { s3Path: string }).s3Path;
      await expect(readFile(join(root, key), 'utf8')).resolves.toBe(
        'jpeg-bytes',
      );
    });

    it('creates intermediate directories', async () => {
      await expect(
        service().replaceImages('v-1', [file()]),
      ).resolves.toBeDefined();
    });

    it('never calls S3 in local mode', async () => {
      await service().replaceImages('v-1', [file()]);

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('replacing the image set', () => {
    const service = () =>
      new ImageUploadService(
        configWith({
          IMAGE_SERVE_MODE: 's3',
          MARKETPLACE_IMAGES_BUCKET: 'bucket',
        }),
        imageRepo as never,
      );

    beforeEach(() => send.mockResolvedValue({}));

    it("deletes the vehicle's existing images before inserting the new set", async () => {
      await service().replaceImages('v-1', [file()]);

      expect(imageRepo.delete).toHaveBeenCalledWith({ vehicleId: 'v-1' });
    });

    it('marks the first file as primary and the rest not', async () => {
      const rows = (await service().replaceImages('v-1', [
        file({ originalname: 'a.jpg' }),
        file({ originalname: 'b.jpg' }),
        file({ originalname: 'c.jpg' }),
      ])) as Array<{ isPrimary: boolean; displayOrder: number }>;

      expect(rows[0]).toMatchObject({ isPrimary: true, displayOrder: 0 });
      expect(rows[1]).toMatchObject({ isPrimary: false, displayOrder: 1 });
      expect(rows[2]).toMatchObject({ isPrimary: false, displayOrder: 2 });
    });

    it('leaves processedPath and thumbnailPath null (no Sharp resize on this path)', async () => {
      const rows = (await service().replaceImages('v-1', [file()])) as Array<{
        processedPath: unknown;
        thumbnailPath: unknown;
      }>;

      expect(rows[0].processedPath).toBeNull();
      expect(rows[0].thumbnailPath).toBeNull();
    });
  });
});
