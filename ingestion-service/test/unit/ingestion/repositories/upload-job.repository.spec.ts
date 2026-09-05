import { UploadJobRepository } from '../../../../src/modules/ingestion/repositories/upload-job.repository';
import type { UploadJob } from '../../../../src/infrastructure/database/entities/upload-job.entity';

describe('UploadJobRepository', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
  };
  let repository: UploadJobRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo.create.mockImplementation((v: unknown) => v);
    repo.save.mockImplementation((v: unknown) => Promise.resolve(v));
    repo.update.mockResolvedValue({ affected: 1 });
    repository = new UploadJobRepository(repo as never);
  });

  describe('create', () => {
    it('starts a job PENDING with zeroed counts', async () => {
      await repository.create({
        dealerId: 'dealer-1',
        fileName: 'inventory.csv',
        csvS3Path: 'raw/job-1/inventory.csv',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PENDING',
          totalRecords: 0,
          validRecords: 0,
          invalidRecords: 0,
        }),
      );
    });

    it('persists via save, not just create', async () => {
      await repository.create({
        dealerId: 'dealer-1',
        fileName: 'inventory.csv',
        csvS3Path: 'raw/job-1/inventory.csv',
      });

      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    // zip_s3_path is nullable; an omitted ZIP must be an explicit null rather
    // than undefined, which TypeORM would drop from the INSERT.
    it('normalizes a missing zip path to null', async () => {
      await repository.create({
        dealerId: 'dealer-1',
        fileName: 'inventory.csv',
        csvS3Path: 'raw/job-1/inventory.csv',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ zipS3Path: null }),
      );
    });

    it('keeps a supplied zip path', async () => {
      await repository.create({
        dealerId: 'dealer-1',
        fileName: 'inventory.csv',
        csvS3Path: 'raw/job-1/inventory.csv',
        zipS3Path: 'raw/job-1/images.zip',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ zipS3Path: 'raw/job-1/images.zip' }),
      );
    });
  });

  describe('findById', () => {
    // Unscoped on purpose: the pipeline runs without a dealer context. Dealer
    // -facing reads go through JobStatusRepository, which scopes by dealerId.
    it('looks up by id alone', async () => {
      repo.findOne.mockResolvedValue({ id: 'job-1' } as UploadJob);

      await repository.findById('job-1');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    it('returns null when absent', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(repository.findById('job-1')).resolves.toBeNull();
    });
  });

  describe('findByDealer', () => {
    it('returns newest first with a total', async () => {
      repo.findAndCount.mockResolvedValue([[{ id: 'job-1' }], 7]);

      await expect(repository.findByDealer('dealer-1')).resolves.toEqual({
        items: [{ id: 'job-1' }],
        total: 7,
      });
      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dealerId: 'dealer-1' },
          order: { createdAt: 'DESC' },
        }),
      );
    });

    it('applies pagination', async () => {
      repo.findAndCount.mockResolvedValue([[], 0]);

      await repository.findByDealer('dealer-1', 5, 10);

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5, skip: 10 }),
      );
    });
  });

  describe('updates', () => {
    it('updates status alone', async () => {
      await repository.updateStatus('job-1', 'PROCESSING');

      expect(repo.update).toHaveBeenCalledWith({ id: 'job-1' }, { status: 'PROCESSING' });
    });

    it('updates the total record count alone', async () => {
      await repository.updateTotal('job-1', 250);

      expect(repo.update).toHaveBeenCalledWith({ id: 'job-1' }, { totalRecords: 250 });
    });

    // Whole-value write, not an increment: chunks run concurrently, so
    // incrementing would need row locking to stay correct.
    it('writes final counts as absolute values', async () => {
      await repository.updateCounts('job-1', { validRecords: 47, invalidRecords: 3 });

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'job-1' },
        { validRecords: 47, invalidRecords: 3 },
      );
    });
  });
});
