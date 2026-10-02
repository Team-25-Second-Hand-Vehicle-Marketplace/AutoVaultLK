import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { JobQueue } from '../../../infrastructure/ports/job-queue.port';

import { JOB_QUEUE } from '../../../infrastructure/ports/job-queue.port';

import type { ObjectStore } from '../../../infrastructure/ports/object-store.port';

import { OBJECT_STORE } from '../../../infrastructure/ports/object-store.port';

import { UploadJobRepository } from '../repositories/upload-job.repository';

import { DealerProfileRepository } from '../repositories/dealer-profile.repository';

export type UploadFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/** What validateCsv/validateZip actually need - UploadFile satisfies this too, so upload() is unaffected. */
type FileMeta = {
  originalname: string;
  size: number;
  mimetype?: string;
};

export type UploadResult = {
  jobId: string;
  status: string;
  fileName: string;
  csvS3Path: string;
  zipS3Path: string | null;
};

export type PresignedUploadTarget = {
  uploadUrl: string;
  headers: Record<string, string>;
};

export type PresignedUpload = {
  jobId: string;
  csv: PresignedUploadTarget;
  zip: PresignedUploadTarget | null;
};

@Injectable()
export class IngestionUploadService {
  private readonly logger = new Logger(IngestionUploadService.name);

  // Adjust these limits if your SRS defines different values.
  private readonly maxCsvSize = 25 * 1024 * 1024; // 25 MB
  private readonly maxZipSize = 250 * 1024 * 1024; // 250 MB

  /**
   * How long a presigned upload URL stays valid. Generous on purpose: a 250 MB
   * ZIP on a slow connection needs real time, and unlike the GET URLs
   * ImageUrlResolverService mints per request, this one is used exactly once
   * right after it's issued, so there is no caching/reuse tradeoff pulling the
   * other way.
   */
  private readonly uploadUrlExpirySeconds = 900; // 15 minutes

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
      await this.objectStore.put(csvKey, csv.buffer, 'text/csv');

      if (zip) {
        zipKey = `raw/${job.id}/${this.safeFileName(zip.originalname)}`;

        await this.objectStore.put(zipKey, zip.buffer, 'application/zip');
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
      await this.uploadJobRepository.updateStoragePaths(job.id, csvKey, zipKey);

      /*
       * Important:
       * publish() only triggers the ETL process.
       * It does NOT wait for ETL completion.
       */
      await this.jobQueue.publish({
        jobId: job.id,
      });

      this.logger.log(`Upload accepted: job=${job.id}, dealer=${dealerId}`);

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

      await this.uploadJobRepository.updateStatus(job.id, 'FAILED');

      throw new InternalServerErrorException('Unable to process upload');
    }
  }

  /**
   * Step 1 of the direct-to-S3 flow: creates the job row (same as upload()
   * does, so it exists the moment a dealer sees a jobId) and returns a
   * presigned PUT per file. The dealer's browser uploads straight to S3 -
   * this service never sees the bytes, and never has to: API Gateway
   * hard-caps a Lambda-proxied request body at 10 MB, well under either file.
   *
   * Storage paths are written now, not after the upload lands - completeUpload
   * only has a jobId to work with, so the keys it verifies and publishes
   * against have to already be on the row.
   */
  async presignUpload(
    dealerId: string,
    csv: { fileName: string; fileSize: number },
    zip?: { fileName: string; fileSize: number },
  ): Promise<PresignedUpload> {
    await this.verifyDealer(dealerId);

    this.validateCsv({ originalname: csv.fileName, size: csv.fileSize });
    if (zip) {
      this.validateZip({ originalname: zip.fileName, size: zip.fileSize });
    }

    const job = await this.uploadJobRepository.create({
      dealerId,
      fileName: csv.fileName,
      csvS3Path: '',
      zipS3Path: null,
    });

    const csvKey = `raw/${job.id}/${this.safeFileName(csv.fileName)}`;
    const zipKey = zip
      ? `raw/${job.id}/${this.safeFileName(zip.fileName)}`
      : null;

    await this.uploadJobRepository.updateStoragePaths(job.id, csvKey, zipKey);

    const csvTarget = await this.objectStore.getUploadTarget(
      csvKey,
      'text/csv',
      this.uploadUrlExpirySeconds,
    );
    const zipTarget = zipKey
      ? await this.objectStore.getUploadTarget(
          zipKey,
          'application/zip',
          this.uploadUrlExpirySeconds,
        )
      : null;

    this.logger.log(`Presigned upload: job=${job.id}, dealer=${dealerId}`);

    return {
      jobId: job.id,
      csv: { uploadUrl: csvTarget.url, headers: csvTarget.headers ?? {} },
      zip: zipTarget
        ? { uploadUrl: zipTarget.url, headers: zipTarget.headers ?? {} }
        : null,
    };
  }

  /**
   * Step 2: the dealer's browser calls this once its direct-to-S3 PUT(s)
   * finish. Confirms the bytes actually landed (a presigned URL that was
   * requested but never used, or failed partway, must not start the
   * pipeline against a file that is not there) before publishing the job.
   */
  async completeUpload(dealerId: string, jobId: string): Promise<UploadResult> {
    const job = await this.uploadJobRepository.findById(jobId);

    if (!job || job.dealerId !== dealerId) {
      // Same response for "no such job" and "someone else's job" - this must
      // not confirm to a caller that a given jobId belongs to another dealer.
      throw new NotFoundException('Upload job not found');
    }

    if (job.status !== 'PENDING') {
      // Already completed (or in flight) - most likely a retried request
      // after a flaky network response. Reporting the existing job back is
      // more useful than erroring on an action that, from the dealer's
      // side, already succeeded.
      return {
        jobId: job.id,
        status: job.status,
        fileName: job.fileName,
        csvS3Path: job.csvS3Path,
        zipS3Path: job.zipS3Path,
      };
    }

    if (!(await this.objectStore.exists(job.csvS3Path))) {
      // Marked FAILED, not left at PENDING: an abandoned upload must not
      // masquerade as "still in progress" forever - getActiveJob() treats a
      // PENDING job as the dealer's active upload and would otherwise block
      // them from starting a fresh one.
      await this.uploadJobRepository.updateStatus(job.id, 'FAILED');
      throw new BadRequestException(
        'CSV upload has not finished - nothing was found at the expected location',
      );
    }

    if (job.zipS3Path && !(await this.objectStore.exists(job.zipS3Path))) {
      await this.uploadJobRepository.updateStatus(job.id, 'FAILED');
      throw new BadRequestException(
        'ZIP upload has not finished - nothing was found at the expected location',
      );
    }

    await this.jobQueue.publish({ jobId: job.id });

    this.logger.log(`Upload confirmed: job=${job.id}, dealer=${dealerId}`);

    return {
      jobId: job.id,
      status: 'PENDING',
      fileName: job.fileName,
      csvS3Path: job.csvS3Path,
      zipS3Path: job.zipS3Path,
    };
  }

  private async verifyDealer(dealerId: string): Promise<void> {
    const allowed =
      await this.dealerProfileRepository.isVerifiedBusinessDealer(dealerId);

    if (!allowed) {
      throw new ForbiddenException(
        'Only verified business dealers can upload inventory',
      );
    }
  }

  private validateCsv(file: FileMeta): void {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    if (file.size <= 0) {
      throw new BadRequestException('CSV file is empty');
    }

    if (file.size > this.maxCsvSize) {
      throw new BadRequestException(
        'CSV file exceeds the maximum allowed size of 25 MB',
      );
    }

    const name = file.originalname.toLowerCase();

    if (!name.endsWith('.csv')) {
      throw new BadRequestException('Inventory file must be a CSV');
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

    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid CSV file type');
    }
  }

  private validateZip(file: FileMeta): void {
    if (file.size <= 0) {
      throw new BadRequestException('ZIP file is empty');
    }

    if (file.size > this.maxZipSize) {
      throw new BadRequestException(
        'ZIP file exceeds the maximum allowed size of 250 MB',
      );
    }

    const name = file.originalname.toLowerCase();

    if (!name.endsWith('.zip')) {
      throw new BadRequestException('Images file must be a ZIP archive');
    }

    const allowedMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/octet-stream',
    ];

    if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid ZIP file type');
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
    const baseName = originalName.split(/[\\/]/).pop() ?? 'upload';

    return baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
  }
}
