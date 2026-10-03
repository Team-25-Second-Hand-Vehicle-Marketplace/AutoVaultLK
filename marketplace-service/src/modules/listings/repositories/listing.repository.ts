import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';

import {
  Vehicle,
  VehicleStatus,
} from '../../../infrastructure/database/entities/vehicle.entity';
import { CreateListingDto } from '../dto/create-listing.dto';
import type { ListingSortOption } from '../dto/my-listings-query.dto';
import { ListingSearchIndexService } from '../services/listing-search-index.service';

// Editing any of these fields changes what buildSearchText() produces, so
// search_text/embedding must be recomputed - not just the plain column.
//
// price and mileage are here because they feed the band phrases: dropping a
// price from 6M to 4M moves the listing from "upper mid range" to "mid range",
// and without a recompute the vector would still say the old one.
const SEARCHABLE_FIELDS = [
  'make',
  'model',
  'manufactureYear',
  'vehicleType',
  'condition',
  'fuelType',
  'transmissionType',
  'price',
  'mileage',
  'locationCity',
  'locationDistrict',
  'specs',
  'description',
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
      vehicleType: dto.vehicleType,
      make: dto.make,
      model: dto.model,
      condition: dto.condition ?? 'USED',
      manufactureYear: dto.manufactureYear,
      registrationYear: dto.registrationYear ?? null,
      price: dto.price,
      mileage: dto.mileage,
      fuelType: dto.fuelType,
      transmissionType: dto.transmissionType,
      color: dto.color,
      engineCapacityCc: dto.engineCapacityCc,
      ownersCount: dto.ownersCount,
      locationDistrict: dto.locationDistrict,
      locationCity: dto.locationCity ?? null,
      registrationNumber: dto.registrationNumber ?? null,
      chassisNumber: dto.chassisNumber ?? null,
      isNegotiable: dto.isNegotiable ?? false,
      description: dto.description ?? null,
      status,
      specs: dto.specs ?? {},
    });

    const { searchText, embedding } =
      await this.searchIndexService.build(vehicle);
    vehicle.searchText = searchText;
    vehicle.embedding = embedding;

    return this.vehicleRepo.save(vehicle);
  }

  /**
   * The same dealer's listing with identical vehicle details created within
   * `windowMs`. A double-click or a retry after a client timeout re-sends the
   * same body; this lets the service return the first listing instead of
   * creating a twin.
   */
  findRecentDuplicate(dto: CreateListingDto, windowMs: number) {
    return this.vehicleRepo.findOne({
      where: {
        dealerId: dto.dealerId,
        make: dto.make,
        model: dto.model,
        manufactureYear: dto.manufactureYear,
        price: dto.price,
        mileage: dto.mileage,
        fuelType: dto.fuelType,
        transmissionType: dto.transmissionType,
        createdAt: MoreThanOrEqual(new Date(Date.now() - windowMs)),
      },
      order: { createdAt: 'DESC' },
    });
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

  findByDealer(dealerId: string, sort?: ListingSortOption) {
    if (sort === 'confidence_asc') {
      return this.vehicleRepo
        .createQueryBuilder('vehicle')
        .leftJoinAndSelect('vehicle.images', 'images')
        .where('vehicle.dealer_id = :dealerId', { dealerId })
        .orderBy(
          `(vehicle.normalization->>'rowConfidence')::numeric`,
          'ASC',
          'NULLS LAST',
        )
        .addOrderBy('vehicle.created_at', 'DESC')
        .addOrderBy('images.display_order', 'ASC')
        .getMany();
    }

    return this.vehicleRepo.find({
      where: { dealerId },
      order: { createdAt: 'DESC' },
      relations: ['images'],
    });
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
    if (data.manufactureYear !== undefined)
      vehicle.manufactureYear = data.manufactureYear;
    if (data.registrationYear !== undefined)
      vehicle.registrationYear = data.registrationYear;
    if (data.price !== undefined) vehicle.price = data.price;
    if (data.mileage !== undefined) vehicle.mileage = data.mileage;
    if (data.fuelType !== undefined) vehicle.fuelType = data.fuelType;
    if (data.transmissionType !== undefined)
      vehicle.transmissionType = data.transmissionType;
    if (data.color !== undefined) vehicle.color = data.color;
    if (data.engineCapacityCc !== undefined)
      vehicle.engineCapacityCc = data.engineCapacityCc;
    if (data.ownersCount !== undefined) vehicle.ownersCount = data.ownersCount;
    if (data.locationDistrict !== undefined)
      vehicle.locationDistrict = data.locationDistrict;
    if (data.locationCity !== undefined)
      vehicle.locationCity = data.locationCity ?? null;
    if (data.registrationNumber !== undefined)
      vehicle.registrationNumber = data.registrationNumber ?? null;
    if (data.chassisNumber !== undefined)
      vehicle.chassisNumber = data.chassisNumber ?? null;
    if (data.isNegotiable !== undefined)
      vehicle.isNegotiable = data.isNegotiable;
    if (data.description !== undefined)
      vehicle.description = data.description ?? null;
    if (data.specs !== undefined) vehicle.specs = data.specs;

    if (searchableFieldChanged) {
      const { searchText, embedding } =
        await this.searchIndexService.build(vehicle);
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

  /**
   * Reverses `deactivate`: brings an ARCHIVED listing back to LIVE. Only
   * valid from ARCHIVED - returns null otherwise (does not exist, or was
   * never archived in the first place), same "say only whether it happened"
   * split as `approve`.
   */
  async unarchive(id: string) {
    const vehicle = await this.findById(id);

    if (!vehicle || vehicle.status !== 'ARCHIVED') {
      return null;
    }

    vehicle.status = 'LIVE';
    return this.vehicleRepo.save(vehicle);
  }

  async approve(id: string) {
    const vehicle = await this.findById(id);

    if (!vehicle || vehicle.status !== 'PENDING_REVIEW') {
      return null;
    }

    vehicle.status = 'LIVE';
    return this.vehicleRepo.save(vehicle);
  }

  async approveAllPending(dealerId: string): Promise<number> {
    const result = await this.vehicleRepo.update(
      { dealerId, status: 'PENDING_REVIEW' },
      { status: 'LIVE' },
    );
    return result.affected ?? 0;
  }

  async approveSelected(dealerId: string, ids: string[]): Promise<number> {
    const result = await this.vehicleRepo.update(
      { dealerId, status: 'PENDING_REVIEW', id: In(ids) },
      { status: 'LIVE' },
    );
    return result.affected ?? 0;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.vehicleRepo.delete({ id });
    return (result.affected ?? 0) > 0;
  }
}
