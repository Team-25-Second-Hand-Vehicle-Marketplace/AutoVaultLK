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

import type {
  UploadFileFormat,
} from '../../../infrastructure/database/entities/upload-job.entity';

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
  format: UploadFileFormat;
  csvS3Path: string;
  zipS3Path: string | null;
};

/**
 * Per declared format: the extension the file must carry, the MIME types a
 * browser or HTTP client may legitimately send for it, and the content type it
 * is stored under. Adding a format means adding a row here and a reader in the
 * ETL worker, and nothing else in this service.
 */
const FORMAT_RULES: Record<
  UploadFileFormat,
  { extension: string; label: string; mimeTypes: string[]; contentType: string }
> = {
  csv: {
    extension: '.csv',
    label: 'CSV',
    mimeTypes: ['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'],
    contentType: 'text/csv',
  },
  json: {
    extension: '.json',
    label: 'JSON',
    mimeTypes: ['application/json', 'text/json', 'text/plain'],
    contentType: 'application/json',
  },
};

@Injectable()
export class IngestionUploadService {
  private readonly logger = new Logger(IngestionUploadService.name);

  // Adjust these limits if your SRS defines different values.
  private readonly maxInventorySize = 25 * 1024 * 1024; // 25 MB, either format
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
    file: UploadFile,
    rawFormat: string | undefined,
    zip?: UploadFile,
  ): Promise<UploadResult> {
    await this.verifyDealer(dealerId);

    const format = this.parseFormat(rawFormat);

    this.validateInventoryFile(format, file);

    if (zip) {
      this.validateZip(zip);
    }

    /*
     * Create the job first so the storage keys can be tied to a stable job ID.
     */
    const job = await this.uploadJobRepository.create({
      dealerId,
      fileName: file.originalname,
      csvS3Path: '',
      zipS3Path: null,
      fileFormat: format,
    });

    const csvKey = `raw/${job.id}/${this.safeFileName(file.originalname)}`;

    let zipKey: string | null = null;

    try {
      await this.objectStore.put(
        csvKey,
        file.buffer,
        FORMAT_RULES[format].contentType,
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
        fileName: file.originalname,
        format,
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

  /**
   * The dealer declares the format; it is never defaulted or guessed from the
   * extension. A silent default would read a JSON file as CSV and fail later
   * with a confusing header error, so an absent or unknown value is rejected
   * here, at upload time.
   */
  private parseFormat(raw: string | undefined): UploadFileFormat {
    const value = raw?.trim().toLowerCase();

    if (!value) {
      throw new BadRequestException(
        'format is required: "csv" or "json"',
      );
    }

    if (Object.prototype.hasOwnProperty.call(FORMAT_RULES, value)) {
      return value as UploadFileFormat;
    }

    throw new BadRequestException(
      `Unsupported format "${raw}". Use "csv" or "json".`,
    );
  }

  /**
   * Checks the file against the format the dealer declared, so a mismatch is
   * reported here, immediately, instead of failing later inside the worker.
   */
  private validateInventoryFile(
    format: UploadFileFormat,
    file: UploadFile,
  ): void {
    const rules = FORMAT_RULES[format];

    if (!file) {
      throw new BadRequestException(
        'Inventory file is required',
      );
    }

    if (file.size <= 0) {
      throw new BadRequestException(
        `${rules.label} file is empty`,
      );
    }

    if (file.size > this.maxInventorySize) {
      throw new BadRequestException(
        `${rules.label} file exceeds the maximum allowed size of 25 MB`,
      );
    }

    const name = file.originalname.toLowerCase();

    if (!name.endsWith(rules.extension)) {
      /*
       * Distinguish "you picked the wrong format" from "this is not an
       * inventory file at all": the first has an obvious fix for the dealer.
       */
      const actual = (Object.keys(FORMAT_RULES) as UploadFileFormat[]).find(
        (other) => name.endsWith(FORMAT_RULES[other].extension),
      );

      if (actual) {
        throw new BadRequestException(
          `You selected ${rules.label} but "${file.originalname}" is a ` +
            `${FORMAT_RULES[actual].label} file. Upload a ${rules.extension} ` +
            `file, or switch the format to ${FORMAT_RULES[actual].label}.`,
        );
      }

      throw new BadRequestException(
        `Inventory file must be a ${rules.label} (${rules.extension}) file`,
      );
    }

    /*
     * Do not rely only on the browser-provided MIME type.
     * The extension is checked as well.
     */
    if (
      file.mimetype &&
      !rules.mimeTypes.includes(file.mimetype)
    ) {
      throw new BadRequestException(
        `Invalid ${rules.label} file type`,
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