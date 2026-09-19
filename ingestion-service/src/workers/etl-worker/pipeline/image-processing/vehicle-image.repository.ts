import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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
