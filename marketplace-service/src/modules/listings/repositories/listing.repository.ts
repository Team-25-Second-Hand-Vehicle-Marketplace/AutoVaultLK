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
import {
  addDays,
  DELETED_SNAPSHOT_DAYS,
  LISTING_TERM_DAYS,
  termFrom,
} from '../listing-expiry';

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
      ...this.publication(status, new Date()),
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

  /**
   * A dealer's own inventory, every status included.
   *
   * `sort: 'confidence_asc'` (FR-42.1) orders by
   * `normalization->>'rowConfidence'` ascending - the rows most likely to
   * need a correction first - with a row that carries no provenance at all
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
    Object.assign(vehicle, this.publication('LIVE', new Date()));
    return this.vehicleRepo.save(vehicle);
  }

  /**
   * FR-42: moves a PENDING_REVIEW listing to LIVE. This is the "explicitly
   * approve" step the FR requires - no ETL-loaded listing becomes publicly
   * visible until the owning dealer takes this action, and until this method
   * existed nothing in the service could take it at all.
   *
   * Returns null both when the listing does not exist and when it exists but
   * is not PENDING_REVIEW (already LIVE, or REJECTED, or a manually-created
   * DRAFT) - the service maps both to the same 404/409 split its caller
   * needs, and this method's job is only to say whether the transition
   * happened, not to explain why it did not.
   */
  async approve(id: string) {
    const vehicle = await this.findById(id);

    if (!vehicle || vehicle.status !== 'PENDING_REVIEW') {
      return null;
    }

    vehicle.status = 'LIVE';
    Object.assign(vehicle, this.publication('LIVE', new Date()));
    return this.vehicleRepo.save(vehicle);
  }

  /**
   * Bulk form of `approve`: moves every PENDING_REVIEW listing owned by
   * `dealerId` to LIVE in one statement and returns how many moved. One UPDATE
   * rather than a loop of `approve` calls, so a bulk upload of hundreds of rows
   * is a single round trip and either all of them move or none do. Scoped by
   * dealer in the WHERE clause itself, so it can never touch another dealer's
   * rows.
   */
  async approveAllPending(dealerId: string): Promise<number> {
    const now = new Date();
    const result = await this.vehicleRepo.update(
      { dealerId, status: 'PENDING_REVIEW' },
      { status: 'LIVE', ...this.publication('LIVE', now) },
    );
    return result.affected ?? 0;
  }

  /**
   * Approves only the listed ids, and only those that are the dealer's own and
   * still PENDING_REVIEW. Anything else in `ids` (someone else's listing, one
   * already live, one that does not exist) is skipped rather than failing the
   * lot, because the dealer's view can be stale by the time they click. The
   * dealer and status conditions live in the WHERE clause itself, so a crafted
   * id list can never touch another dealer's rows.
   */
  async approveSelected(dealerId: string, ids: string[]): Promise<number> {
    const now = new Date();
    const result = await this.vehicleRepo.update(
      { dealerId, status: 'PENDING_REVIEW', id: In(ids) },
      { status: 'LIVE', ...this.publication('LIVE', now) },
    );
    return result.affected ?? 0;
  }

  /**
   * Permanently removes a listing, in one transaction: a snapshot kept for
   * dispute review, an audit entry, then the row itself. Any status the dealer
   * owns can be deleted.
   *
   * `vehicle_images` cascades on `vehicle_id` (migration 7000) and
   * `favourites` cascades on `vehicle_id` (migration 10000), so this needs no
   * manual cleanup of either - the FK constraints do it in the same
   * transaction as the DELETE.
   */
  async deletePermanently(id: string, actorId: string, now: Date): Promise<boolean> {
    return this.vehicleRepo.manager.transaction(async (manager) => {
      const vehicle = await manager.findOne(Vehicle, {
        where: { id },
        relations: ['images'],
      });

      if (!vehicle) {
        return false;
      }

      const { embedding: _embedding, searchText: _searchText, searchVector: _searchVector, ...fields } =
        vehicle;

      await manager.query(
        `INSERT INTO marketplace.deleted_listing_snapshots
           (vehicle_id, dealer_id, registration_number, snapshot, deleted_by, deleted_at, purge_after)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
        [
          vehicle.id,
          vehicle.dealerId,
          vehicle.registrationNumber,
          JSON.stringify(fields),
          actorId,
          now,
          addDays(now, DELETED_SNAPSHOT_DAYS),
        ],
      );

      await manager.query(
        `INSERT INTO marketplace.listing_audit_log
           (action, vehicle_id, dealer_id, registration_number, actor_id, details, created_at)
         VALUES ('LISTING_DELETED', $1, $2, $3, $4, $5::jsonb, $6)`,
        [
          vehicle.id,
          vehicle.dealerId,
          vehicle.registrationNumber,
          actorId,
          JSON.stringify({ status: vehicle.status, imageCount: vehicle.images?.length ?? 0 }),
          now,
        ],
      );

      const result = await manager.delete(Vehicle, { id });
      return (result.affected ?? 0) > 0;
    });
  }

  /** Sets the expiry of a LIVE listing. Returns null when it is no longer LIVE. */
  async setExpiry(id: string, expiresAt: Date) {
    const vehicle = await this.findById(id);

    if (!vehicle || vehicle.status !== 'LIVE') {
      return null;
    }

    vehicle.expiresAt = expiresAt;
    return this.vehicleRepo.save(vehicle);
  }

  /** Brings an ARCHIVED listing back to LIVE with a fresh 90-day term. */
  async relist(id: string, now: Date) {
    const vehicle = await this.findById(id);

    if (!vehicle || vehicle.status !== 'ARCHIVED') {
      return null;
    }

    vehicle.status = 'LIVE';
    Object.assign(vehicle, this.publication('LIVE', now));
    return this.vehicleRepo.save(vehicle);
  }

  /**
   * Renews the dealer's LIVE listings in one UPDATE. Each renewed listing gets
   * renewedExpiry: 90 days from its expiry, or from now if it has already lapsed.
   * The dealer check and the status check live in the WHERE clause, so a crafted
   * id list cannot reach another dealer's rows.
   */
  async renewMany(
    dealerId: string,
    ids: string[] | undefined,
    expiringWithinDays: number | undefined,
  ): Promise<number> {
    const query = this.vehicleRepo
      .createQueryBuilder()
      .update(Vehicle)
      .set({
        expiresAt: () =>
          `GREATEST(COALESCE(expires_at, now()), now()) + interval '${LISTING_TERM_DAYS} days'`,
      })
      .where('dealer_id = :dealerId', { dealerId })
      .andWhere('status = :status', { status: 'LIVE' })
      .andWhere('deleted_at IS NULL');

    if (ids) {
      query.andWhere('id IN (:...ids)', { ids });
    }
    if (expiringWithinDays !== undefined) {
      query.andWhere(`expires_at <= now() + make_interval(days => :days)`, {
        days: expiringWithinDays,
      });
    }

    const result = await query.execute();
    return result.affected ?? 0;
  }

  /** Publish and expiry dates for a status. Only LIVE listings carry a term. */
  private publication(status: VehicleStatus, now: Date) {
    if (status !== 'LIVE') {
      return { publishedAt: null, expiresAt: null };
    }
    return { publishedAt: now, expiresAt: termFrom(now) };
  }
}
