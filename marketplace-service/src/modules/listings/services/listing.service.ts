import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { DealerSummary } from '../../dealers/repositories/dealer.repository';
import { DealerService } from '../../dealers/services/dealer.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { ListingRepository } from '../repositories/listing.repository';
import { Vehicle } from '../../../infrastructure/database/entities/vehicle.entity';

@Injectable()
export class ListingService {
  constructor(
    private readonly listingRepository: ListingRepository,
    private readonly dealerService: DealerService,
  ) {}

  async createListing(dto: CreateListingDto) {
    await this.dealerService.getDealerById(dto.dealerId);

    const status = dto.status ?? 'LIVE';
    const listing = await this.listingRepository.create(dto, status);

    return {
      message: 'Vehicle listing created successfully',
      data: listing,
    };
  }

  async getAllListings() {
    const listings = await this.listingRepository.findAllLive();

    return {
      message: 'Vehicle listings retrieved successfully',
      data: await Promise.all(
        listings.map((listing) => this.withDealer(listing)),
      ),
    };
  }

  async getListingById(id: string) {
    const listing = await this.listingRepository.findById(id);

    if (!listing || listing.status !== 'LIVE') {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    return {
      message: 'Vehicle listing retrieved successfully',
      data: await this.withDealer(listing),
    };
  }

  async updateListing(id: string, dto: UpdateListingDto) {
    const listing = await this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    if (dto.dealerId && dto.dealerId !== listing.dealerId) {
      await this.dealerService.getDealerById(dto.dealerId);
    }

    const updatedListing = await this.listingRepository.update(id, dto);

    return {
      message: 'Vehicle listing updated successfully',
      data: updatedListing,
    };
  }

  async deactivateListing(id: string) {
    const listing = await this.listingRepository.deactivate(id);

    if (!listing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    return {
      message: 'Vehicle listing deactivated successfully',
      data: listing,
    };
  }

  async createBulkListings(dtos: CreateListingDto[]) {
    const invalidDealerIds: string[] = [];

    for (const dto of dtos) {
      try {
        await this.dealerService.getDealerById(dto.dealerId);
      } catch {
        invalidDealerIds.push(dto.dealerId);
      }
    }

    if (invalidDealerIds.length > 0) {
      throw new NotFoundException(
        `Dealer(s) with ID ${invalidDealerIds.join(', ')} not found`,
      );
    }

    const listings = await this.listingRepository.createBulk(
      dtos,
      'PENDING_REVIEW',
    );

    return {
      message: 'Bulk vehicle listings created successfully',
      total: listings.length,
      data: listings,
    };
  }

  private async withDealer(listing: Vehicle) {
    try {
      const dealer = await this.dealerService.getDealerById(listing.dealerId);
      return { ...listing, dealer: this.toDealerPayload(dealer) };
    } catch {
      return { ...listing, dealer: null };
    }
  }

  private toDealerPayload(dealer: DealerSummary) {
    return {
      id: dealer.id,
      businessName: dealer.businessName,
      ownerName: dealer.ownerName,
      city: dealer.city,
      phone: dealer.phone,
    };
  }
}
