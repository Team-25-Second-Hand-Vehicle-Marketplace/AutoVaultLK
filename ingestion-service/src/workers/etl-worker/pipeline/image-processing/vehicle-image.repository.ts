import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { VehicleImageWriteEntity } from '../../../../infrastructure/database/entities/vehicle-image.write-entity';
import { VehicleWriteEntity } from '../../../../infrastructure/database/entities/vehicle.write-entity';
import { coerceRegistrationNumber } from '../normalize/coerce';

@Injectable()
export class VehicleImageRepository {
  constructor(
    @InjectRepository(VehicleWriteEntity)
    private readonly vehicleRepository: Repository<VehicleWriteEntity>,

    @InjectRepository(VehicleImageWriteEntity)
    private readonly imageRepository: Repository<VehicleImageWriteEntity>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findVehicleByRegistration(
    registrationNumber: string,
    jobId: string,
  ): Promise<VehicleWriteEntity | null> {
    const normalizedRegistration = coerceRegistrationNumber(registrationNumber);
    if (!normalizedRegistration) {
      return null;
    }

    return this.vehicleRepository.findOne({
      where: {
        registrationNumber: normalizedRegistration,
        uploadJobId: jobId,
      },
    });
  }

  /**
   * Whether this job already rejected a row for this registration number.
   *
   * Images run concurrently with the chunk Map, so an image's vehicle row
   * being absent is ordinarily just a race — the retry loop in
   * process-job-images.service.ts waits it out. But a row that VALIDATE_ROWS
   * (or the file gate) rejected will NEVER produce a vehicle row, no matter
   * how long the retry waits; this lets the caller tell "still loading" from
   * "provably never coming" and stop immediately instead of burning the
   * whole retry budget on every image whose row simply failed validation.
   *
   * `rejected_records.raw_data` holds the untouched CSV cell — "cad-7201",
   * "CAD 7201" and "CAD-7201" are all the same plate but different text —
   * while the image side has already been through coerceRegistrationNumber.
   * Rather than reimplement that coercion in SQL, this compares both sides
   * with punctuation and case stripped out entirely: loose enough that a
   * false negative (missing a real rejection) is very unlikely, and a false
   * positive only costs a redundant DB round trip, never a wrongly-skipped
   * match — the caller still falls through to its own timed retry either way.
   */
  async wasRejected(jobId: string, registrationNumber: string): Promise<boolean> {
    const [row] = (await this.dataSource.query(
      `SELECT 1 FROM ingestion.rejected_records
        WHERE upload_job_id = $1
          AND regexp_replace(upper(raw_data->>'registration_number'), '[^A-Z0-9]', '', 'g')
            = regexp_replace(upper($2), '[^A-Z0-9]', '', 'g')
        LIMIT 1`,
      [jobId, registrationNumber],
    )) as unknown[];

    return row !== undefined;
  }

  async findImageBySource(
    vehicleId: string,
    s3Path: string,
  ): Promise<VehicleImageWriteEntity | null> {
    return this.imageRepository.findOne({
      where: {
        vehicleId,
        s3Path,
      },
    });
  }

  async countImagesForVehicle(vehicleId: string): Promise<number> {
    return this.imageRepository.count({
      where: {
        vehicleId,
      },
    });
  }

  async insertImage(input: {
    vehicleId: string;
    s3Path: string;
    processedPath: string;
    thumbnailPath: string;
    isPrimary: boolean;
    displayOrder: number;
  }): Promise<VehicleImageWriteEntity> {
    const image = this.imageRepository.create({
      vehicleId: input.vehicleId,
      s3Path: input.s3Path,
      processedPath: input.processedPath,
      thumbnailPath: input.thumbnailPath,
      isPrimary: input.isPrimary,
      displayOrder: input.displayOrder,
    });

    return this.imageRepository.save(image);
  }
}
