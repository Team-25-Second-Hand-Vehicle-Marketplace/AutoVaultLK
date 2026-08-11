import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  Condition,
  FuelType,
  TransmissionType,
  Vehicle,
  VehicleType,
} from '../../../infrastructure/database/entities/vehicle.entity';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';

type VehicleWriteFields = Partial<
  Pick<
    Vehicle,
    | 'dealerId'
    | 'vehicleType'
    | 'make'
    | 'model'
    | 'condition'
    | 'manufactureYear'
    | 'registrationYear'
    | 'price'
    | 'isNegotiable'
    | 'mileage'
    | 'fuelType'
    | 'transmissionType'
    | 'engineCapacityCc'
    | 'color'
    | 'ownersCount'
    | 'locationCity'
    | 'locationDistrict'
    | 'registrationNumber'
    | 'chassisNumber'
    | 'description'
    | 'specs'
  >
>;

@Injectable()
export class ListingRepository {
  constructor(
    @InjectRepository(Vehicle)
    private readonly repository: Repository<Vehicle>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateListingDto) {
    const listing = this.repository.create({
      ...this.toCreateFields(dto),
      status: 'PENDING_REVIEW',
    });

    return this.repository.save(listing);
  }

  async findAll() {
    return this.repository.find({
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findById(id: string) {
    return this.repository.findOne({
      where: {
        id,
      },
    });
  }

  async exists(id: string) {
    return this.repository.exists({
      where: {
        id,
      },
    });
  }

  async update(
    id: string,
    data: UpdateListingDto,
  ) {
    const listing = await this.findById(id);

    if (!listing) {
      return null;
    }

    Object.assign(listing, this.toUpdateFields(data));

    return this.repository.save(listing);
  }

  async deactivate(id: string) {
    const listing = await this.findById(id);

    if (!listing) {
      return null;
    }

    listing.status = 'ARCHIVED';

    return this.repository.save(listing);
  }

  async createBulk(dtos: CreateListingDto[]) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Vehicle);
      const listings = dtos.map((dto) =>
        repository.create({
          ...this.toCreateFields(dto),
          status: 'PENDING_REVIEW',
        }),
      );

      return repository.save(listings);
    });
  }

  private toCreateFields(
    dto: CreateListingDto,
  ): VehicleWriteFields {
    return {
      dealerId: dto.dealerId,
      vehicleType: (dto.vehicleType ?? 'CAR') as VehicleType,
      make: dto.make,
      model: dto.model,
      condition: (dto.condition ?? 'USED') as Condition,
      manufactureYear: dto.manufactureYear,
      registrationYear: dto.registrationYear ?? null,
      price: dto.price,
      isNegotiable: dto.isNegotiable ?? false,
      mileage: dto.mileage,
      fuelType: dto.fuelType
        ? (dto.fuelType as FuelType)
        : null,
      transmissionType: dto.transmissionType
        ? (dto.transmissionType as TransmissionType)
        : null,
      engineCapacityCc: dto.engineCapacityCc ?? null,
      color: dto.color ?? null,
      ownersCount: dto.ownersCount ?? null,
      locationCity: dto.locationCity ?? null,
      locationDistrict: dto.locationDistrict ?? null,
      registrationNumber: dto.registrationNumber ?? null,
      chassisNumber: dto.chassisNumber ?? null,
      description: dto.description ?? null,
      specs: dto.specs ?? {},
    };
  }

  private toUpdateFields(
    dto: UpdateListingDto,
  ): VehicleWriteFields {
    const fields: VehicleWriteFields = {};

    if (dto.dealerId !== undefined) fields.dealerId = dto.dealerId;
    if (dto.vehicleType !== undefined) {
      fields.vehicleType = dto.vehicleType as VehicleType;
    }
    if (dto.make !== undefined) fields.make = dto.make;
    if (dto.model !== undefined) fields.model = dto.model;
    if (dto.condition !== undefined) {
      fields.condition = dto.condition as Condition;
    }
    if (dto.manufactureYear !== undefined) {
      fields.manufactureYear = dto.manufactureYear;
    }
    if (dto.registrationYear !== undefined) {
      fields.registrationYear = dto.registrationYear;
    }
    if (dto.price !== undefined) fields.price = dto.price;
    if (dto.isNegotiable !== undefined) {
      fields.isNegotiable = dto.isNegotiable;
    }
    if (dto.mileage !== undefined) fields.mileage = dto.mileage;
    if (dto.fuelType !== undefined) {
      fields.fuelType = dto.fuelType as FuelType;
    }
    if (dto.transmissionType !== undefined) {
      fields.transmissionType =
        dto.transmissionType as TransmissionType;
    }
    if (dto.engineCapacityCc !== undefined) {
      fields.engineCapacityCc = dto.engineCapacityCc;
    }
    if (dto.color !== undefined) fields.color = dto.color;
    if (dto.ownersCount !== undefined) {
      fields.ownersCount = dto.ownersCount;
    }
    if (dto.locationCity !== undefined) {
      fields.locationCity = dto.locationCity;
    }
    if (dto.locationDistrict !== undefined) {
      fields.locationDistrict = dto.locationDistrict;
    }
    if (dto.registrationNumber !== undefined) {
      fields.registrationNumber = dto.registrationNumber;
    }
    if (dto.chassisNumber !== undefined) {
      fields.chassisNumber = dto.chassisNumber;
    }
    if (dto.description !== undefined) {
      fields.description = dto.description;
    }
    if (dto.specs !== undefined) fields.specs = dto.specs;

    return fields;
  }
}
