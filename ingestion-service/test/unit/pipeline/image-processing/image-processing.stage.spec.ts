import sharp from 'sharp';
import { processVehicleImage } from '../../../../src/workers/etl-worker/pipeline/image-processing/image-processing.stage';

const imageBuffer = async (): Promise<Buffer> =>
  sharp({
    create: {
      width: 20,
      height: 10,
      channels: 3,
      background: '#ff0000',
    },
  })
    .png()
    .toBuffer();

const store = (source: Buffer) => {
  const objects = new Map<string, Buffer>([['raw/job-1/ABC1234.jpg', source]]);

  return {
    objects,
    get: jest.fn(async (key: string) => objects.get(key) ?? Buffer.alloc(0)),
    put: jest.fn(async (key: string, body: Buffer) => {
      objects.set(key, body);
      return key;
    }),
  };
};

describe('processVehicleImage', () => {
  it('keeps the original and writes processed image plus thumbnail keys', async () => {
    const source = await imageBuffer();
    const objectStore = store(source);

    const result = await processVehicleImage(objectStore as never, {
      jobId: 'job-1',
      vehicleId: 'vehicle-1',
      sourceKey: 'raw/job-1/ABC1234.jpg',
      displayOrder: 0,
      isPrimary: true,
    });

    expect(result.processedKey).toMatch(
      /^images\/job-1\/vehicle-1\/0-.+\.jpg$/,
    );
    expect(result.thumbnailKey).toMatch(
      /^images\/job-1\/vehicle-1\/0-.+-thumb\.jpg$/,
    );
    expect(objectStore.objects.get('raw/job-1/ABC1234.jpg')).toBe(source);
    expect(objectStore.put).toHaveBeenCalledTimes(2);
    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
  });

  it('rejects a source key from another job', async () => {
    await expect(
      processVehicleImage(store(await imageBuffer()) as never, {
        jobId: 'job-1',
        vehicleId: 'vehicle-1',
        sourceKey: 'raw/job-2/ABC1234.jpg',
        displayOrder: 0,
        isPrimary: true,
      }),
    ).rejects.toThrow(/Invalid image source key/);
  });

  it('handles an empty image safely', async () => {
    await expect(
      processVehicleImage(store(Buffer.alloc(0)) as never, {
        jobId: 'job-1',
        vehicleId: 'vehicle-1',
        sourceKey: 'raw/job-1/ABC1234.jpg',
        displayOrder: 0,
        isPrimary: true,
      }),
    ).rejects.toThrow(/empty/);
  });
});
