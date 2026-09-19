import { Readable } from 'node:stream';
import { S3ObjectStore } from '../../../../src/infrastructure/storage/s3-object-store';

const send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class MockCommand {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send })),
    GetObjectCommand: class extends MockCommand {},
    HeadObjectCommand: class extends MockCommand {},
    ListObjectsV2Command: class extends MockCommand {},
  };
});

const uploadDone = jest.fn();
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((args: unknown) => {
    uploadDone(args);
    return { done: jest.fn().mockResolvedValue(undefined) };
  }),
}));

const config = (...args: [] | [string | undefined]) => {
  // Distinguishes "not passed" from "explicitly undefined": the default
  // parameter would otherwise turn config(undefined) back into a valid bucket.
  const bucket = args.length === 0 ? 'test-bucket' : args[0];
  return {
    get: (key: string) => (key === 'INGESTION_S3_BUCKET' ? bucket : 'ap-southeast-1'),
  } as never;
};

const store = () => new S3ObjectStore(config());

const inputOf = (call = 0): Record<string, unknown> =>
  (send.mock.calls[call][0] as { input: Record<string, unknown> }).input;

describe('S3ObjectStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    send.mockResolvedValue({});
  });

  describe('construction', () => {
    it('refuses to start without a bucket', () => {
      // A service that starts, accepts an upload and only then discovers it has
      // nowhere to put it has already told the dealer their file was received.
      expect(() => new S3ObjectStore(config(undefined))).toThrow(/INGESTION_S3_BUCKET/);
      expect(() => new S3ObjectStore(config('   '))).toThrow(/INGESTION_S3_BUCKET/);
    });
  });

  describe('put', () => {
    it('uploads through lib-storage so large files go multipart', async () => {
      // A dealer's 25MB CSV is past the point where a single PUT is wise.
      await store().put('raw/job-1/stock.csv', Buffer.from('a,b'), 'text/csv');

      expect(uploadDone).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Bucket: 'test-bucket',
            Key: 'raw/job-1/stock.csv',
            ContentType: 'text/csv',
          }),
        }),
      );
    });

    it('omits ContentType when the caller gives none', async () => {
      await store().put('k', 'body');

      const params = (uploadDone.mock.calls[0][0] as { params: Record<string, unknown> }).params;
      expect(params).not.toHaveProperty('ContentType');
    });

    it('returns the key it stored under', async () => {
      await expect(store().put('k', 'b')).resolves.toBe('k');
    });
  });

  describe('get', () => {
    it('returns the object as a Buffer', async () => {
      send.mockResolvedValue({
        Body: { transformToByteArray: async () => new Uint8Array([104, 105]) },
      });

      await expect(store().get('k')).resolves.toEqual(Buffer.from('hi'));
    });

    it('throws when the response carries no body', async () => {
      send.mockResolvedValue({});

      await expect(store().get('k')).rejects.toThrow(/no body/);
    });
  });

  describe('getStream', () => {
    it('passes a Node stream straight through', async () => {
      const body = Readable.from([Buffer.from('a,b')]);
      send.mockResolvedValue({ Body: body });

      await expect(store().getStream('k')).resolves.toBe(body);
    });

    it('converts a web stream to a Node stream', async () => {
      // splitChunks pipes this into csv-parse, a Node stream consumer. A web
      // ReadableStream has no .pipe and would fail at runtime with a message
      // that says nothing about why.
      const web = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([97]));
          controller.close();
        },
      });
      send.mockResolvedValue({ Body: web });

      const result = await store().getStream('k');

      expect(typeof (result as Readable).pipe).toBe('function');
    });
  });

  describe('exists', () => {
    it('uses HeadObject rather than transferring the body', async () => {
      await store().exists('k');

      expect(inputOf()).toEqual({ Bucket: 'test-bucket', Key: 'k' });
    });

    it('reports a missing key as false', async () => {
      send.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotFound' }));

      await expect(store().exists('k')).resolves.toBe(false);
    });

    it('reports a 404 status as false', async () => {
      send.mockRejectedValue(
        Object.assign(new Error('nope'), { $metadata: { httpStatusCode: 404 } }),
      );

      await expect(store().exists('k')).resolves.toBe(false);
    });

    it('propagates a permissions failure rather than calling it missing', async () => {
      // Reporting AccessDenied as "not found" would send the pipeline looking
      // for a file it was simply not allowed to see.
      send.mockRejectedValue(
        Object.assign(new Error('denied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        }),
      );

      await expect(store().exists('k')).rejects.toThrow(/denied/);
    });
  });

  describe('list', () => {
    it('pages through a truncated listing', async () => {
      // S3 caps a response at 1000 keys. Listing only the first page would
      // make the pipeline process a prefix of the file and report success.
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'a' }, { Key: 'b' }],
          IsTruncated: true,
          NextContinuationToken: 'tok',
        })
        .mockResolvedValueOnce({ Contents: [{ Key: 'c' }], IsTruncated: false });

      await expect(store().list('prefix/')).resolves.toEqual(['a', 'b', 'c']);
      expect(send).toHaveBeenCalledTimes(2);
      expect(inputOf(1)).toMatchObject({ ContinuationToken: 'tok' });
    });

    it('returns an empty list for a prefix that matches nothing', async () => {
      send.mockResolvedValue({ IsTruncated: false });

      await expect(store().list('nothing/')).resolves.toEqual([]);
    });

    it('sorts, so the two drivers cannot disagree on order', async () => {
      send.mockResolvedValue({ Contents: [{ Key: 'b' }, { Key: 'a' }], IsTruncated: false });

      await expect(store().list('p/')).resolves.toEqual(['a', 'b']);
    });
  });

  describe('key validation', () => {
    // S3's flat namespace makes traversal meaningless — `../../etc/passwd` is
    // just an object name. Only genuine caller bugs are rejected.
    it.each([[''], ['\0']])('rejects the invalid key %j', async (key) => {
      await expect(store().get(key)).rejects.toThrow(/Invalid object key/);
    });

    it('accepts a key that would escape a filesystem', async () => {
      send.mockResolvedValue({ Body: { transformToByteArray: async () => new Uint8Array() } });

      await expect(store().get('../../etc/passwd')).resolves.toBeInstanceOf(Buffer);
    });
  });
});
