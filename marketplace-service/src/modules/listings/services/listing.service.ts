import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ListingRepository } from '../repositories/listing.repository';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { DealerRepository } from 'src/modules/dealers/repositories/dealer.repository';

@Injectable()
export class ListingService {
  constructor(
    private readonly listingRepository: ListingRepository,
    private readonly dealerRepository: DealerRepository,
  ) {}

  createListing(dto: CreateListingDto) {
    const dealer = this.dealerRepository.findById(dto.dealerId);

    if (!dealer) {
      throw new NotFoundException(
        `Dealer with ID ${dto.dealerId} not found`,
      );
    }

    const listing = this.listingRepository.create(dto);

    return {
      message: 'Vehicle listing created successfully',
      data: listing,
    };
  }

  getAllListings() {
    const listings = this.listingRepository.findAll();

    return {
      message: 'Vehicle listings retrieved successfully',
      data: listings.map((listing) => {
        const dealer = this.dealerRepository.findById(
          listing.dealerId,
        );

        return {
          ...listing,
          dealer: dealer
            ? {
                id: dealer.id,
                businessName: dealer.businessName,
                ownerName: dealer.ownerName,
                city: dealer.city,
                phone: dealer.phone,
              }
            : null,
        };
      }),
    };
  }

  getListingById(id: number) {
    const listing = this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    const dealer = this.dealerRepository.findById(
      listing.dealerId,
    );

    return {
      message: 'Vehicle listing retrieved successfully',
      data: {
        ...listing,
        dealer: dealer
          ? {
              id: dealer.id,
              businessName: dealer.businessName,
              ownerName: dealer.ownerName,
              city: dealer.city,
              phone: dealer.phone,
            }
          : null,
      },
    };
  }

  updateListing(
    id: number,
    dto: UpdateListingDto,
  ) {
    const listing = this.listingRepository.update(id, dto);

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    return {
      message: 'Vehicle listing updated successfully',
      data: listing,
    };
  }

  deactivateListing(id: number) {
    const listing = this.listingRepository.deactivate(id);

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

  createBulkListings(dtos: CreateListingDto[]) {
    // Validate all dealers exist before creating any listings
    const invalidDealers = dtos.filter(
      (dto) => !this.dealerRepository.findById(dto.dealerId)
    );

    if (invalidDealers.length > 0) {
      const invalidIds = invalidDealers
        .map((dto) => dto.dealerId)
        .join(', ');
      throw new NotFoundException(
        `Dealer(s) with ID ${invalidIds} not found`,
      );
    }

    const listings = this.listingRepository.createBulk(dtos);

    return {
      message: 'Bulk vehicle listings created successfully',
      total: listings.length,
      data: listings,
    };
  }
}