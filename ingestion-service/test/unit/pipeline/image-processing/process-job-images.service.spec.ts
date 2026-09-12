jest.mock('unzipper', () => ({
  Open: {
    buffer: jest.fn(),
  },
}));

import unzipper from 'unzipper';
import { ProcessJobImagesService } from '../../../../src/workers/etl-worker/pipeline/image-processing/process-job-images.service';
import type { ImageProcessingOutput } from '../../../../src/workers/etl-worker/pipeline/image-processing/image-processing.stage';

const mockZip = (files: unknown[]): void => {
  (unzipper.Open.buffer as jest.Mock).mockResolvedValue({ files });
};

const entry = (path: string, body = 'image') => ({
  type: 'File',
  path,
  buffer: jest.fn().mockResolvedValue(Buffer.from(body)),
});

const output = (
  sourceKey: string,
  order: number,
  isPrimary: boolean,
): ImageProcessingOutput => ({
  vehicleId: 'vehicle-1',
  sourceKey,
  processedKey: `images/job-1/vehicle-1/${order}-processed.jpg`,
  thumbnailKey: `images/job-1/vehicle-1/${order}-thumb.jpg`,
  displayOrder: order,
  isPrimary,
  width: 800,
  height: 600,
  sizeBytes: 100,
  thumbnailSizeBytes: 20,
});

const harness = () => {
  const inserted: unknown[] = [];
  const repo = {
    findVehicleByRegistration: jest.fn(
      async (registration: string, jobId: string) =>
        registration === 'ABC-1234' && jobId === 'job-1'
          ? {
              id: 'vehicle-1',
              registrationNumber: 'ABC-1234',
              uploadJobId: 'job-1',
            }
          : null,
    ),
    findImageBySource: jest.fn().mockResolvedValue(null),
    countImagesForVehicle: jest.fn(async () => inserted.length),
    insertImage: jest.fn(async (image: unknown) => {
      inserted.push(image);
      return image;
    }),
  };
  const processor = jest.fn(async (_store, input) =>
    output(input.sourceKey, input.displayOrder, input.isPrimary),
  );
  const service = new ProcessJobImagesService(repo as never);
  service.setImageProcessorForTest(processor as never);

  return {
    inserted,
    processor,
    repo,
    service,
    store: {
      get: jest.fn().mockResolvedValue(Buffer.from('zip')),
      put: jest.fn(async (key: string) => key),
    },
  };
};

describe('ProcessJobImagesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes one image and inserts vehicle_images', async () => {
    mockZip([entry('ABC1234.jpg')]);
    const h = harness();

    const result = await h.service.run(h.store as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(h.processor).toHaveBeenCalledWith(h.store, {
      jobId: 'job-1',
      vehicleId: 'vehicle-1',
      sourceKey: 'raw/job-1/images/ABC1234.jpg',
      displayOrder: 0,
      isPrimary: true,
    });
    expect(h.repo.insertImage).toHaveBeenCalledWith({
      vehicleId: 'vehicle-1',
      s3Path: 'raw/job-1/images/ABC1234.jpg',
      processedPath: 'images/job-1/vehicle-1/0-processed.jpg',
      thumbnailPath: 'images/job-1/vehicle-1/0-thumb.jpg',
      isPrimary: true,
      displayOrder: 0,
    });
    expect(result.processed).toBe(1);
  });

  it('orders multiple images and keeps only the first primary', async () => {
    mockZip([entry('ABC1234.jpg'), entry('ABC1234_1.jpg')]);
    const h = harness();

    await h.service.run(h.store as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(h.processor.mock.calls.map((call) => call[1].displayOrder)).toEqual([
      0, 1,
    ]);
    expect(h.processor.mock.calls.map((call) => call[1].isPrimary)).toEqual([
      true,
      false,
    ]);
  });

  it('skips images with unknown registrations', async () => {
    mockZip([entry('UNKNOWN999.jpg')]);
    const h = harness();

    const result = await h.service.run(h.store as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(result.unmatched).toBe(1);
    expect(h.processor).not.toHaveBeenCalled();
    expect(h.repo.insertImage).not.toHaveBeenCalled();
  });

  it('does not match a vehicle from another upload job', async () => {
    mockZip([entry('ABC1234.jpg')]);
    const h = harness();

    await h.service.run(h.store as never, {
      jobId: 'job-2',
      zipKey: 'raw/job-2/images.zip',
    });

    expect(h.repo.findVehicleByRegistration).toHaveBeenCalledWith(
      'ABC-1234',
      'job-2',
    );
    expect(h.processor).not.toHaveBeenCalled();
  });

  it('skips unsupported file types during extraction', async () => {
    mockZip([entry('ABC1234.txt')]);
    const h = harness();

    const result = await h.service.run(h.store as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(result.extracted).toBe(0);
    expect(h.processor).not.toHaveBeenCalled();
  });

  it('skips corrupt images without crashing the batch', async () => {
    mockZip([entry('ABC1234.jpg'), entry('ABC1234_1.jpg')]);
    const h = harness();
    h.processor
      .mockRejectedValueOnce(new Error('Invalid image'))
      .mockImplementationOnce(async (_store, input) =>
        output(input.sourceKey, input.displayOrder, input.isPrimary),
      );

    const result = await h.service.run(h.store as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
    expect(h.repo.insertImage).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate rows on retry', async () => {
    mockZip([entry('ABC1234.jpg')]);
    const h = harness();
    h.repo.findImageBySource.mockResolvedValue({ id: 'image-1' });

    const result = await h.service.run(h.store as never, {
      jobId: 'job-1',
      zipKey: 'raw/job-1/images.zip',
    });

    expect(result.duplicates).toBe(1);
    expect(h.processor).not.toHaveBeenCalled();
    expect(h.repo.insertImage).not.toHaveBeenCalled();
  });

  it('rejects unsafe ZIP entries', async () => {
    mockZip([entry('../../file.jpg')]);
    const h = harness();

    await expect(
      h.service.run(h.store as never, {
        jobId: 'job-1',
        zipKey: 'raw/job-1/images.zip',
      }),
    ).rejects.toThrow(/Unsafe ZIP entry/);
  });
});
