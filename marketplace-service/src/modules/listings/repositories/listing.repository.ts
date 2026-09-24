import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  Vehicle,
  VehicleStatus,
} from '../../../infrastructure/database/entities/vehicle.entity';
import { CreateListingDto } from '../dto/create-listing.dto';
import type { ListingSortOption } from '../dto/my-listings-query.dto';
import { ListingSearchIndexService } from '../services/listing-search-index.service';

// Editing any of these fields changes what buildSearchText() produces, so
// search_text/embedding must be recomputed — not just the plain column.
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

    const { searchText, embedding } =
      await this.searchIndexService.build(vehicle);
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

  /**
   * A dealer's own inventory, every status included.
   *
   * `sort: 'confidence_asc'` (FR-42.1) orders by
   * `normalization->>'rowConfidence'` ascending — the rows most likely to
   * need a correction first — with a row that carries no provenance at all
   * (a manually-created listing, or one that predates migration 29000)
   * placed last via NULLS LAST: there is nothing in it to review, so it
   * should not crowd out the ones that do.
   *
   * The default stays `createdAt DESC` for every other case, matching the
   * behaviour before this sort option existed.
   */
  findByDealer(dealerId: string, sort?: ListingSortOption) {
    if (sort === 'confidence_asc') {
      return this.vehicleRepo
        .createQueryBuilder('vehicle')
        .where('vehicle.dealer_id = :dealerId', { dealerId })
        .orderBy(
          `(vehicle.normalization->>'rowConfidence')::numeric`,
          'ASC',
          'NULLS LAST',
        )
        .addOrderBy('vehicle.created_at', 'DESC')
        .getMany();
    }

    return this.vehicleRepo.find({
      where: { dealerId },
      order: { createdAt: 'DESC' },
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
   * FR-42: moves a PENDING_REVIEW listing to LIVE. This is the "explicitly
   * approve" step the FR requires — no ETL-loaded listing becomes publicly
   * visible until the owning dealer takes this action, and until this method
   * existed nothing in the service could take it at all.
   *
   * Returns null both when the listing does not exist and when it exists but
   * is not PENDING_REVIEW (already LIVE, or REJECTED, or a manually-created
   * DRAFT) — the service maps both to the same 404/409 split its caller
   * needs, and this method's job is only to say whether the transition
   * happened, not to explain why it did not.
   */
  async approve(id: string) {
    const vehicle = await this.findById(id);

    if (!vehicle || vehicle.status !== 'PENDING_REVIEW') {
      return null;
    }

    vehicle.status = 'LIVE';
    return this.vehicleRepo.save(vehicle);
  }
}
