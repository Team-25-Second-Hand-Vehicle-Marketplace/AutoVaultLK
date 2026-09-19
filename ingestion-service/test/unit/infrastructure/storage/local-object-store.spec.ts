import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { LocalObjectStore } from '../../../../src/infrastructure/storage/local-object-store';

describe('LocalObjectStore', () => {
  let root: string;
  let store: LocalObjectStore;

  const configWith = (value: string): ConfigService =>
    ({ get: () => value }) as unknown as ConfigService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ingestion-store-'));
    store = new LocalObjectStore(configWith(root));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips a buffer through put and get', async () => {
    await store.put('raw/job-1/vehicles.csv', Buffer.from('make,model\nToyota,Aqua\n'));

    expect((await store.get('raw/job-1/vehicles.csv')).toString()).toBe(
      'make,model\nToyota,Aqua\n',
    );
  });

  it('creates intermediate directories and returns the key', async () => {
    await expect(store.put('staging/job-1/deep/nested/chunk-0.json', '[]')).resolves.toBe(
      'staging/job-1/deep/nested/chunk-0.json',
    );
  });

  it('reports existence without throwing on a missing key', async () => {
    expect(await store.exists('raw/absent.csv')).toBe(false);

    await store.put('raw/present.csv', 'x');
    expect(await store.exists('raw/present.csv')).toBe(true);
  });

  it('streams a stored object', async () => {
    await store.put('raw/job-1/a.csv', 'hello');

    const chunks: Buffer[] = [];
    for await (const chunk of await store.getStream('raw/job-1/a.csv')) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString()).toBe('hello');
  });

  // Rejecting here rather than on a later stream 'error' event keeps the
  // failure attributable to the stage that asked for the key.
  it('rejects getStream for a missing key rather than returning a broken stream', async () => {
    await expect(store.getStream('raw/absent.csv')).rejects.toThrow();
  });

  it('lists keys recursively under a prefix, in posix form', async () => {
    await store.put('staging/job-1/chunk-0.json', '[]');
    await store.put('staging/job-1/nested/chunk-1.json', '[]');
    await store.put('staging/job-2/chunk-0.json', '[]');

    expect(await store.list('staging/job-1')).toEqual([
      'staging/job-1/chunk-0.json',
      'staging/job-1/nested/chunk-1.json',
    ]);
  });

  it('treats a missing prefix as an empty listing, matching S3', async () => {
    await expect(store.list('staging/absent')).resolves.toEqual([]);
  });

  // Keys are built from dealer-supplied filenames. Escaping the root is the one
  // failure mode that turns a bad upload into a host compromise.
  it.each([
    ['../escape.csv'],
    ['raw/../../escape.csv'],
    ['raw/job-1/../../../etc/passwd'],
    ['a/../../b'],
  ])('refuses key %s that escapes the storage root', async (key) => {
    await expect(store.put(key, 'x')).rejects.toThrow(/escapes the storage root/);
    await expect(store.get(key)).rejects.toThrow(/escapes the storage root/);
    await expect(store.exists(key)).rejects.toThrow(/escapes the storage root/);
  });

  it.each([[''], ['/absolute/path.csv'], ['bad\0key.csv']])(
    'refuses malformed key %j',
    async (key) => {
      await expect(store.put(key, 'x')).rejects.toThrow(/Invalid object key/);
    },
  );

  it('does not surface files written outside the root in a listing', async () => {
    const outside = join(root, '..', 'ingestion-store-outside-marker');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.txt'), 'nope');

    await store.put('raw/job-1/a.csv', 'x');

    expect(await store.list('raw')).toEqual(['raw/job-1/a.csv']);
    await rm(outside, { recursive: true, force: true });
  });
});
