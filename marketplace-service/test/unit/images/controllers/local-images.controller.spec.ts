import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotFoundException, StreamableFile } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LocalImagesController } from '../../../../src/modules/images/controllers/local-images.controller';

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

/** Reads a StreamableFile's stream fully, so a test can assert on bytes. */
async function readAll(file: StreamableFile): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of file.getStream()) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

describe('LocalImagesController', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'marketplace-images-'));
    await mkdir(join(root, 'images', 'job-1', 'veh-1'), { recursive: true });
    await writeFile(
      join(root, 'images', 'job-1', 'veh-1', '0-x.jpg'),
      'jpeg-bytes',
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const controller = (mode = 'local') =>
    new LocalImagesController(
      configWith({
        IMAGE_SERVE_MODE: mode,
        MARKETPLACE_IMAGES_LOCAL_ROOT: root,
      }),
    );

  it('streams a file that exists', async () => {
    const file = await controller().stream([
      'images',
      'job-1',
      'veh-1',
      '0-x.jpg',
    ]);

    expect(await readAll(file)).toBe('jpeg-bytes');
  });

  it('sets the content type from the extension', async () => {
    const file = await controller().stream([
      'images',
      'job-1',
      'veh-1',
      '0-x.jpg',
    ]);

    expect(file.options.type).toBe('image/jpeg');
  });

  it.each([
    ['.png', 'image/png'],
    ['.webp', 'image/webp'],
  ])('recognises %s', async (ext, contentType) => {
    await writeFile(
      join(root, 'images', 'job-1', 'veh-1', `1-x${ext}`),
      'bytes',
    );

    const file = await controller().stream([
      'images',
      'job-1',
      'veh-1',
      `1-x${ext}`,
    ]);

    expect(file.options.type).toBe(contentType);
  });

  it('falls back to a generic content type for an unrecognised extension', async () => {
    await writeFile(join(root, 'images', 'job-1', 'veh-1', '2-x.bin'), 'bytes');

    const file = await controller().stream([
      'images',
      'job-1',
      'veh-1',
      '2-x.bin',
    ]);

    expect(file.options.type).toBe('application/octet-stream');
  });

  it('404s a key that does not exist on disk', async () => {
    await expect(
      controller().stream(['images', 'job-1', 'veh-1', 'missing.jpg']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // The security-critical case: a request built from `../../` segments must
  // 404 exactly like a missing file, not reveal anything about the
  // filesystem outside the storage root.
  it('404s rather than serves a path that escapes the storage root', async () => {
    await expect(
      controller().stream(['..', '..', 'etc', 'passwd']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('joins multi-segment wildcard params back into the original key', async () => {
    // NestJS 11's *key wildcard hands back one array entry per path
    // segment, not the joined string — this is the behaviour the resolver
    // (ImageUrlResolverService) relies on to reconstruct the object key it
    // originally built the URL from.
    const file = await controller().stream([
      'images',
      'job-1',
      'veh-1',
      '0-x.jpg',
    ]);

    expect(await readAll(file)).toBe('jpeg-bytes');
  });

  it.each(['s3', 'demo'])(
    'refuses to serve when the configured mode is not local (%s)',
    async (mode) => {
      await expect(
        controller(mode).stream(['images', 'job-1', 'veh-1', '0-x.jpg']),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );
});
