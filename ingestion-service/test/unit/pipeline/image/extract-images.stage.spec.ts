jest.mock('unzipper', () => ({
  Open: {
    buffer: jest.fn(),
  },
}));

import unzipper from 'unzipper';
import { extractImagesStage } from '../../../../src/workers/etl-worker/pipeline/image/extract-images.stage';

const mockZip = (files: unknown[]): void => {
  (unzipper.Open.buffer as jest.Mock).mockResolvedValue({ files });
};

const entry = (path: string, body = 'image') => ({
  type: 'File',
  path,
  buffer: jest.fn().mockResolvedValue(Buffer.from(body)),
});

const store = (zip = Buffer.from('zip')) => ({
  get: jest.fn().mockResolvedValue(zip),
  put: jest.fn(async (key: string) => key),
});

describe('extractImagesStage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts supported images under the raw job prefix', async () => {
    mockZip([entry('ABC1234.jpg'), entry('ABC1234_1.png')]);
    const objectStore = store();

    const result = await extractImagesStage(objectStore as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(result.images).toEqual([
      {
        fileName: 'ABC1234.jpg',
        key: 'raw/job-1/images/ABC1234.jpg',
        registrationNumber: 'ABC-1234',
      },
      {
        fileName: 'ABC1234_1.png',
        key: 'raw/job-1/images/ABC1234_1.png',
        registrationNumber: 'ABC-1234',
      },
    ]);
    expect(objectStore.put).toHaveBeenCalledTimes(2);
  });

  it('skips unsupported file types without storing them', async () => {
    mockZip([entry('ABC1234.txt'), entry('ABC1234.pdf')]);
    const objectStore = store();

    const result = await extractImagesStage(objectStore as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(result.images).toEqual([]);
    expect(objectStore.put).not.toHaveBeenCalled();
  });

  it('rejects path traversal entries before reading their body', async () => {
    const unsafe = entry('../etc/passwd.jpg');
    mockZip([unsafe]);

    await expect(
      extractImagesStage(store() as never, {
        jobId: 'job-1',
        zipKey: 'raw/job-1/images.zip',
      }),
    ).rejects.toThrow(/Unsafe ZIP entry/);

    expect(unsafe.buffer).not.toHaveBeenCalled();
  });
});
