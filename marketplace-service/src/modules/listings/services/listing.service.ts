import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ListingRepository } from '../repositories/listing.repository';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { DealerService } from 'src/modules/dealers/services/dealer.service';

@Injectable()
export class ListingService {
  constructor(
    private readonly listingRepository: ListingRepository,
    private readonly dealerService: DealerService,
  ) {}

  createListing(dto: CreateListingDto) {
    this.dealerService.getDealerById(dto.dealerId);

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
        try {
          const dealer = this.dealerService.getDealerById(
            listing.dealerId,
          );
          return {
            ...listing,
            dealer: {
              id: dealer.id,
              businessName: dealer.businessName,
              ownerName: dealer.ownerName,
              city: dealer.city,
              phone: dealer.phone,
            },
          };
        } catch (error) {
          return {
            ...listing,
            dealer: null,
          };
        }
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

    try {
      const dealer = this.dealerService.getDealerById(
        listing.dealerId,
      );
      return {
        message: 'Vehicle listing retrieved successfully',
        data: {
          ...listing,
          dealer: {
            id: dealer.id,
            businessName: dealer.businessName,
            ownerName: dealer.ownerName,
            city: dealer.city,
            phone: dealer.phone,
          },
        },
      };
    } catch (error) {
      return {
        message: 'Vehicle listing retrieved successfully',
        data: {
          ...listing,
          dealer: null,
        },
      };
    }
  }

  updateListing(
    id: number,
    dto: UpdateListingDto,
  ) {
    const listing = this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    // Validate new dealer if dealerId is being updated
    if (dto.dealerId && dto.dealerId !== listing.dealerId) {
      this.dealerService.getDealerById(dto.dealerId);
    }

    const updatedListing = this.listingRepository.update(id, dto);

    return {
      message: 'Vehicle listing updated successfully',
      data: updatedListing,
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
    const invalidDealerIds: number[] = [];
    
    for (const dto of dtos) {
      try {
        this.dealerService.getDealerById(dto.dealerId);
      } catch (error) {
        invalidDealerIds.push(dto.dealerId);
      }
    }

    if (invalidDealerIds.length > 0) {
      throw new NotFoundException(
        `Dealer(s) with ID ${invalidDealerIds.join(', ')} not found`,
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