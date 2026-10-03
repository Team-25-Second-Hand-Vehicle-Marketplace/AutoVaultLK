import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IngestionUploadService } from '../../../../src/modules/ingestion/services/ingestion-upload.service';

describe('IngestionUploadService', () => {
  const dealerProfileRepository = {
    isVerifiedBusinessDealer: jest.fn(),
  };
  const uploadJobRepository = {
    create: jest.fn(),
    findById: jest.fn(),
    updateStoragePaths: jest.fn(),
    updateStatus: jest.fn(),
  };
  const objectStore = {
    getUploadTarget: jest.fn(),
    exists: jest.fn(),
    put: jest.fn(),
  };
  const jobQueue = {
    publish: jest.fn(),
  };

  const service = () =>
    new IngestionUploadService(
      uploadJobRepository as never,
      dealerProfileRepository as never,
      objectStore as never,
      jobQueue,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    dealerProfileRepository.isVerifiedBusinessDealer.mockResolvedValue(true);
  });

  describe('presignUpload', () => {
    it('refuses a dealer who is not a verified business dealer', async () => {
      dealerProfileRepository.isVerifiedBusinessDealer.mockResolvedValue(false);

      await expect(
        service().presignUpload(
          'dealer-1',
          { fileName: 'stock.csv', fileSize: 100 },
          'csv',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(uploadJobRepository.create).not.toHaveBeenCalled();
    });

    it('refuses a CSV over the 25 MB limit before creating a job', async () => {
      await expect(
        service().presignUpload(
          'dealer-1',
          { fileName: 'stock.csv', fileSize: 26 * 1024 * 1024 },
          'csv',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(uploadJobRepository.create).not.toHaveBeenCalled();
    });

    it('refuses a ZIP over the 250 MB limit before creating a job', async () => {
      await expect(
        service().presignUpload(
          'dealer-1',
          { fileName: 'stock.csv', fileSize: 100 },
          'csv',
          { fileName: 'photos.zip', fileSize: 251 * 1024 * 1024 },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(uploadJobRepository.create).not.toHaveBeenCalled();
    });

    it('creates the job, stores both keys, and returns a presigned PUT per file', async () => {
      uploadJobRepository.create.mockResolvedValue({ id: 'job-1' });
      objectStore.getUploadTarget
        .mockResolvedValueOnce({
          url: 'https://csv-put',
          headers: { 'Content-Type': 'text/csv' },
        })
        .mockResolvedValueOnce({
          url: 'https://zip-put',
          headers: { 'Content-Type': 'application/zip' },
        });

      const result = await service().presignUpload(
        'dealer-1',
        { fileName: 'stock.csv', fileSize: 1000 },
        'csv',
        { fileName: 'photos.zip', fileSize: 2000 },
      );

      expect(result).toEqual({
        jobId: 'job-1',
        format: 'csv',
        csv: {
          uploadUrl: 'https://csv-put',
          headers: { 'Content-Type': 'text/csv' },
        },
        zip: {
          uploadUrl: 'https://zip-put',
          headers: { 'Content-Type': 'application/zip' },
        },
      });
      expect(uploadJobRepository.updateStoragePaths).toHaveBeenCalledWith(
        'job-1',
        'raw/job-1/stock.csv',
        'raw/job-1/photos.zip',
      );
      expect(objectStore.getUploadTarget).toHaveBeenNthCalledWith(
        1,
        'raw/job-1/stock.csv',
        'text/csv',
        900,
      );
      expect(objectStore.getUploadTarget).toHaveBeenNthCalledWith(
        2,
        'raw/job-1/photos.zip',
        'application/zip',
        900,
      );
      // Nothing is published here - that only happens once completeUpload
      // confirms the bytes actually landed.
      expect(jobQueue.publish).not.toHaveBeenCalled();
    });

    it('returns a null zip target when no zip was requested', async () => {
      uploadJobRepository.create.mockResolvedValue({ id: 'job-1' });
      objectStore.getUploadTarget.mockResolvedValue({
        url: 'https://csv-put',
        headers: {},
      });

      const result = await service().presignUpload(
        'dealer-1',
        { fileName: 'stock.csv', fileSize: 1000 },
        'csv',
      );

      expect(result.zip).toBeNull();
      expect(uploadJobRepository.updateStoragePaths).toHaveBeenCalledWith(
        'job-1',
        'raw/job-1/stock.csv',
        null,
      );
      expect(objectStore.getUploadTarget).toHaveBeenCalledTimes(1);
    });
  });

  describe('presignUpload - declared format', () => {
    it('requires the format and never guesses it from the extension', async () => {
      await expect(
        service().presignUpload(
          'dealer-1',
          { fileName: 'stock.json', fileSize: 100 },
          undefined,
        ),
      ).rejects.toThrow(/format is required/);

      expect(uploadJobRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown format', async () => {
      await expect(
        service().presignUpload(
          'dealer-1',
          { fileName: 'stock.xml', fileSize: 100 },
          'xml',
        ),
      ).rejects.toThrow(/Unsupported format/);
    });

    it('rejects a file whose extension contradicts the declared format', async () => {
      await expect(
        service().presignUpload(
          'dealer-1',
          { fileName: 'stock.csv', fileSize: 100 },
          'json',
        ),
      ).rejects.toThrow(/You selected JSON but "stock.csv" is a CSV file/);

      expect(uploadJobRepository.create).not.toHaveBeenCalled();
    });

    it('stores a JSON job with its format and a JSON content type', async () => {
      uploadJobRepository.create.mockResolvedValue({ id: 'job-2' });
      objectStore.getUploadTarget.mockResolvedValue({
        url: 'https://json-put',
        headers: { 'Content-Type': 'application/json' },
      });

      const result = await service().presignUpload(
        'dealer-1',
        { fileName: 'stock.json', fileSize: 1000 },
        'json',
      );

      expect(result.format).toBe('json');
      expect(uploadJobRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'stock.json', fileFormat: 'json' }),
      );
      expect(objectStore.getUploadTarget).toHaveBeenCalledWith(
        'raw/job-2/stock.json',
        'application/json',
        900,
      );
    });
  });

  describe('completeUpload', () => {
    const pendingJob = {
      id: 'job-1',
      dealerId: 'dealer-1',
      status: 'PENDING',
      fileName: 'stock.csv',
      fileFormat: 'csv',
      csvS3Path: 'raw/job-1/stock.csv',
      zipS3Path: null,
    };

    it('404s on a job that does not exist', async () => {
      uploadJobRepository.findById.mockResolvedValue(null);

      await expect(
        service().completeUpload('dealer-1', 'job-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it("404s (not 403) on another dealer's job, so existence is never confirmed", async () => {
      uploadJobRepository.findById.mockResolvedValue({
        ...pendingJob,
        dealerId: 'someone-else',
      });

      await expect(
        service().completeUpload('dealer-1', 'job-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the CSV never actually landed in storage, and marks the job FAILED', async () => {
      uploadJobRepository.findById.mockResolvedValue(pendingJob);
      objectStore.exists.mockResolvedValue(false);

      await expect(
        service().completeUpload('dealer-1', 'job-1'),
      ).rejects.toThrow(BadRequestException);
      expect(jobQueue.publish).not.toHaveBeenCalled();
      // Not left at PENDING: getActiveJob() treats PENDING as "still in
      // progress" and would otherwise block the dealer from retrying.
      expect(uploadJobRepository.updateStatus).toHaveBeenCalledWith(
        'job-1',
        'FAILED',
      );
    });

    it('rejects when the ZIP never actually landed in storage, and marks the job FAILED', async () => {
      uploadJobRepository.findById.mockResolvedValue({
        ...pendingJob,
        zipS3Path: 'raw/job-1/photos.zip',
      });
      objectStore.exists.mockImplementation((key: string) =>
        Promise.resolve(key === pendingJob.csvS3Path),
      );

      await expect(
        service().completeUpload('dealer-1', 'job-1'),
      ).rejects.toThrow(BadRequestException);
      expect(jobQueue.publish).not.toHaveBeenCalled();
      expect(uploadJobRepository.updateStatus).toHaveBeenCalledWith(
        'job-1',
        'FAILED',
      );
    });

    it('does not mark the job FAILED when every expected file is present', async () => {
      uploadJobRepository.findById.mockResolvedValue(pendingJob);
      objectStore.exists.mockResolvedValue(true);

      await service().completeUpload('dealer-1', 'job-1');

      expect(uploadJobRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('publishes the job once every expected file is confirmed present', async () => {
      uploadJobRepository.findById.mockResolvedValue(pendingJob);
      objectStore.exists.mockResolvedValue(true);

      const result = await service().completeUpload('dealer-1', 'job-1');

      expect(jobQueue.publish).toHaveBeenCalledWith({ jobId: 'job-1' });
      expect(result).toEqual({
        jobId: 'job-1',
        status: 'PENDING',
        fileName: 'stock.csv',
        format: 'csv',
        csvS3Path: 'raw/job-1/stock.csv',
        zipS3Path: null,
      });
    });

    it('is idempotent: a job already past PENDING is reported back without re-publishing', async () => {
      uploadJobRepository.findById.mockResolvedValue({
        ...pendingJob,
        status: 'PROCESSING',
      });

      const result = await service().completeUpload('dealer-1', 'job-1');

      expect(result.status).toBe('PROCESSING');
      expect(jobQueue.publish).not.toHaveBeenCalled();
      expect(objectStore.exists).not.toHaveBeenCalled();
    });
  });
});
