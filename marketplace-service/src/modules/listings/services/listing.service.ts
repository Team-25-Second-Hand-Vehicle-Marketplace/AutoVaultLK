import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DealerSummary } from '../../dealers/repositories/dealer.repository';
import { DealerService } from '../../dealers/services/dealer.service';
import { Vehicle } from '../../../infrastructure/database/entities/vehicle.entity';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { ListingRepository } from '../repositories/listing.repository';

@Injectable()
export class ListingService {
  constructor(
    private readonly listingRepository: ListingRepository,
    private readonly dealerService: DealerService,
  ) {}

  async createListing(dto: CreateListingDto) {
    await this.dealerService.assertDealerExists(dto.dealerId);

    const listing = await this.listingRepository.create(dto);
    const dealer = await this.dealerService.getDealerById(
      listing.dealerId,
    );

    return {
      message: 'Vehicle listing created successfully',
      data: this.withDealer(listing, dealer),
    };
  }

  async getAllListings() {
    const listings = await this.listingRepository.findAll();
    const dealersById = await this.getDealersById(listings);

    return {
      message: 'Vehicle listings retrieved successfully',
      data: listings.map((listing) =>
        this.withDealer(
          listing,
          dealersById.get(listing.dealerId) ?? null,
        ),
      ),
    };
  }

  async getListingById(id: string) {
    const listing = await this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    const dealer = await this.dealerService.getDealerById(
      listing.dealerId,
    );

    return {
      message: 'Vehicle listing retrieved successfully',
      data: this.withDealer(listing, dealer),
    };
  }

  async updateListing(id: string, dto: UpdateListingDto) {
    if (dto.dealerId) {
      await this.dealerService.assertDealerExists(dto.dealerId);
    }

    const listing = await this.listingRepository.update(
      id,
      dto,
    );

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    const dealer = await this.dealerService.getDealerById(
      listing.dealerId,
    );

    return {
      message: 'Vehicle listing updated successfully',
      data: this.withDealer(listing, dealer),
    };
  }

  async deactivateListing(id: string) {
    const listing =
      await this.listingRepository.deactivate(id);

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    return {
      message: 'Vehicle listing deactivated successfully',
      data: listing,
    };
  }

  async createBulkListings(dtos: CreateListingDto[]) {
    if (!Array.isArray(dtos) || dtos.length === 0) {
      throw new BadRequestException(
        'At least one listing is required',
      );
    }

    const requestedDealerIds = [
      ...new Set(dtos.map((dto) => dto.dealerId)),
    ];
    const dealers =
      await this.dealerService.getDealersByIds(
        requestedDealerIds,
      );
    const validDealerIds = new Set(
      dealers.map((dealer) => dealer.id),
    );
    const missingDealerIds = requestedDealerIds.filter(
      (dealerId) => !validDealerIds.has(dealerId),
    );

    if (missingDealerIds.length > 0) {
      throw new NotFoundException(
        `Dealer(s) with ID ${missingDealerIds.join(', ')} not found`,
      );
    }

    const listings =
      await this.listingRepository.createBulk(dtos);
    const dealersById = new Map(
      dealers.map((dealer) => [dealer.id, dealer]),
    );

    return {
      message:
        'Bulk vehicle listings created successfully',
      total: listings.length,
      data: listings.map((listing) =>
        this.withDealer(
          listing,
          dealersById.get(listing.dealerId) ?? null,
        ),
      ),
    };
  }

  private async getDealersById(listings: Vehicle[]) {
    const dealerIds = listings.map(
      (listing) => listing.dealerId,
    );
    const dealers =
      await this.dealerService.getDealersByIds(dealerIds);

    return new Map(
      dealers.map((dealer) => [dealer.id, dealer]),
    );
  }

  private withDealer(
    listing: Vehicle,
    dealer: DealerSummary | null,
  ) {
    return {
      ...listing,
      dealer,
    };
  }
}
