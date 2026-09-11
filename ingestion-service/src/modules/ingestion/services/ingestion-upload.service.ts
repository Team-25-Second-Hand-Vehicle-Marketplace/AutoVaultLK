import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import type {
  JobQueue,
} from '../../../infrastructure/ports/job-queue.port';

import  {
  JOB_QUEUE,
} from '../../../infrastructure/ports/job-queue.port';

import type{
  ObjectStore,
} from '../../../infrastructure/ports/object-store.port';

import {
  OBJECT_STORE,
} from '../../../infrastructure/ports/object-store.port';

import {
  UploadJobRepository,
} from '../repositories/upload-job.repository';

import {
  DealerProfileRepository,
} from '../repositories/dealer-profile.repository';

export type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export type UploadResult = {
  jobId: string;
  status: string;
  fileName: string;
  csvS3Path: string;
  zipS3Path: string | null;
};

@Injectable()
export class IngestionUploadService {
  private readonly logger = new Logger(IngestionUploadService.name);

  // Adjust these limits if your SRS defines different values.
  private readonly maxCsvSize = 25 * 1024 * 1024; // 25 MB
  private readonly maxZipSize = 250 * 1024 * 1024; // 250 MB

  constructor(
    private readonly uploadJobRepository: UploadJobRepository,
    private readonly dealerProfileRepository: DealerProfileRepository,

    @Inject(OBJECT_STORE)
    private readonly objectStore: ObjectStore,

    @Inject(JOB_QUEUE)
    private readonly jobQueue: JobQueue,
  ) {}

  async upload(
    dealerId: string,
    csv: UploadFile,
    zip?: UploadFile,
  ): Promise<UploadResult> {
    await this.verifyDealer(dealerId);

    this.validateCsv(csv);

    if (zip) {
      this.validateZip(zip);
    }

    /*
     * Create the job first so the storage keys can be tied to a stable job ID.
     */
    const job = await this.uploadJobRepository.create({
      dealerId,
      fileName: csv.originalname,
      csvS3Path: '',
      zipS3Path: null,
    });

    const csvKey = `raw/${job.id}/${this.safeFileName(csv.originalname)}`;

    let zipKey: string | null = null;

    try {
      await this.objectStore.put(
        csvKey,
        csv.buffer,
        'text/csv',
      );

      if (zip) {
        zipKey = `raw/${job.id}/${this.safeFileName(zip.originalname)}`;

        await this.objectStore.put(
          zipKey,
          zip.buffer,
          'application/zip',
        );
      }

      /*
       * Update the job with the actual storage locations.
       */
      const repoJob = await this.uploadJobRepository.findById(job.id);

      if (!repoJob) {
        throw new Error(`Upload job ${job.id} disappeared after creation`);
      }

      /*
       * TypeORM repository does not currently expose a generic update method
       * for paths, so use the repository's underlying update through a small
       * method added below.
       */
      await this.uploadJobRepository.updateStoragePaths(
        job.id,
        csvKey,
        zipKey,
      );

      /*
       * Important:
       * publish() only triggers the ETL process.
       * It does NOT wait for ETL completion.
       */
      await this.jobQueue.publish({
        jobId: job.id,
      });

      this.logger.log(
        `Upload accepted: job=${job.id}, dealer=${dealerId}`,
      );

      return {
        jobId: job.id,
        status: 'PENDING',
        fileName: csv.originalname,
        csvS3Path: csvKey,
        zipS3Path: zipKey,
      };
    } catch (error) {
      this.logger.error(
        `Upload failed for job ${job.id}`,
        error instanceof Error ? error.stack : String(error),
      );

      await this.uploadJobRepository.updateStatus(
        job.id,
        'FAILED',
      );

      throw new InternalServerErrorException(
        'Unable to process upload',
      );
    }
  }

  private async verifyDealer(dealerId: string): Promise<void> {
    const allowed =
      await this.dealerProfileRepository.isVerifiedBusinessDealer(
        dealerId,
      );

    if (!allowed) {
      throw new ForbiddenException(
        'Only verified business dealers can upload inventory',
      );
    }
  }

  private validateCsv(file: UploadFile): void {
    if (!file) {
      throw new BadRequestException(
        'CSV file is required',
      );
    }

    if (file.size <= 0) {
      throw new BadRequestException(
        'CSV file is empty',
      );
    }

    if (file.size > this.maxCsvSize) {
      throw new BadRequestException(
        'CSV file exceeds the maximum allowed size of 25 MB',
      );
    }

    const name = file.originalname.toLowerCase();

    if (!name.endsWith('.csv')) {
      throw new BadRequestException(
        'Inventory file must be a CSV',
      );
    }

    /*
     * Do not rely only on the browser-provided MIME type.
     * The extension is checked as well.
     */
    const allowedMimeTypes = [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'text/plain',
    ];

    if (
      file.mimetype &&
      !allowedMimeTypes.includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'Invalid CSV file type',
      );
    }
  }

  private validateZip(file: UploadFile): void {
    if (file.size <= 0) {
      throw new BadRequestException(
        'ZIP file is empty',
      );
    }

    if (file.size > this.maxZipSize) {
      throw new BadRequestException(
        'ZIP file exceeds the maximum allowed size of 250 MB',
      );
    }

    const name = file.originalname.toLowerCase();

    if (!name.endsWith('.zip')) {
      throw new BadRequestException(
        'Images file must be a ZIP archive',
      );
    }

    const allowedMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
    ];

    if (
      file.mimetype &&
      !allowedMimeTypes.includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'Invalid ZIP file type',
      );
    }
  }

  private safeFileName(originalName: string): string {
    /*
     * Never use the dealer supplied filename directly as a filesystem path.
     *
     * Example:
     * ../../etc/passwd.csv
     *
     * becomes:
     * etc_passwd.csv
     */
    const baseName = originalName
      .split(/[\\/]/)
      .pop() ?? 'upload';

    return baseName
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^\.+/, '_');
  }
}