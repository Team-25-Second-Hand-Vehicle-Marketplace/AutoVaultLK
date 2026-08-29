import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Vehicle, VehicleStatus } from '../../../infrastructure/database/entities/vehicle.entity';
import { CreateListingDto } from '../dto/create-listing.dto';
import { ListingSearchIndexService } from '../services/listing-search-index.service';

// Editing any of these fields changes what buildSearchText() produces, so
// search_text/embedding must be recomputed — not just the plain column.
const SEARCHABLE_FIELDS = [
  'make', 'model', 'manufactureYear', 'vehicleType',
  'fuelType', 'transmissionType', 'specs', 'description',
] as const satisfies readonly (keyof CreateListingDto)[];

@Injectable()
export class ListingRepository {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    private readonly searchIndexService: ListingSearchIndexService,
  ) {}

  async create(dto: CreateListingDto, status: VehicleStatus) {
    const vehicle = this.vehicleRepo.create({
      dealerId: dto.dealerId,
      vehicleType: dto.vehicleType ?? 'CAR',
      make: dto.make,
      model: dto.model,
      condition: dto.condition ?? 'USED',
      manufactureYear: dto.manufactureYear,
      registrationYear: dto.registrationYear ?? null,
      price: dto.price,
      mileage: dto.mileage,
      fuelType: dto.fuelType,
      transmissionType: dto.transmissionType,
      description: dto.description ?? null,
      status,
      specs: dto.specs ?? {},
    });

    const { searchText, embedding } = await this.searchIndexService.build(vehicle);
    vehicle.searchText = searchText;
    vehicle.embedding = embedding;

    return this.vehicleRepo.save(vehicle);
  }

  findAllLive() {
    return this.vehicleRepo.find({
      where: { status: 'LIVE' },
      order: { createdAt: 'DESC' },
    });
  }

  findById(id: string) {
    return this.vehicleRepo.findOne({ where: { id } });
  }

  async update(id: string, data: Partial<CreateListingDto>) {
    const vehicle = await this.findById(id);

    if (!vehicle) {
      return null;
    }

    const searchableFieldChanged = SEARCHABLE_FIELDS.some(
      (field) => data[field] !== undefined,
    );

    if (data.dealerId !== undefined) vehicle.dealerId = data.dealerId;
    if (data.vehicleType !== undefined) vehicle.vehicleType = data.vehicleType;
    if (data.make !== undefined) vehicle.make = data.make;
    if (data.model !== undefined) vehicle.model = data.model;
    if (data.condition !== undefined) vehicle.condition = data.condition;
    if (data.manufactureYear !== undefined) vehicle.manufactureYear = data.manufactureYear;
    if (data.registrationYear !== undefined) vehicle.registrationYear = data.registrationYear;
    if (data.price !== undefined) vehicle.price = data.price;
    if (data.mileage !== undefined) vehicle.mileage = data.mileage;
    if (data.fuelType !== undefined) vehicle.fuelType = data.fuelType;
    if (data.transmissionType !== undefined) vehicle.transmissionType = data.transmissionType;
    if (data.description !== undefined) vehicle.description = data.description ?? null;
    if (data.specs !== undefined) vehicle.specs = data.specs;

    if (searchableFieldChanged) {
      const { searchText, embedding } = await this.searchIndexService.build(vehicle);
      vehicle.searchText = searchText;
      vehicle.embedding = embedding;
    }

    return this.vehicleRepo.save(vehicle);
  }

  async deactivate(id: string) {
    const vehicle = await this.findById(id);

    if (!vehicle) {
      return null;
    }

    vehicle.status = 'ARCHIVED';
    return this.vehicleRepo.save(vehicle);
  }
}
