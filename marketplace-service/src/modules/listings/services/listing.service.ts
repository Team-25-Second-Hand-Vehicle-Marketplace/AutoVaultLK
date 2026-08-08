import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ListingRepository } from '../repositories/listing.repository';
import { CreateListingDto } from '../dto/create-listing.dto';

@Injectable()
export class ListingService {
  constructor(
    private readonly listingRepository: ListingRepository,
  ) {}

  createListing(dto: CreateListingDto) {
    const listing = this.listingRepository.create(dto);

    return {
      message: 'Vehicle listing created successfully',
      data: listing,
    };
  }

  getAllListings() {
    return {
      message: 'Vehicle listings retrieved successfully',
      data: this.listingRepository.findAll(),
    };
  }

  getListingById(id: number) {
    const listing = this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(
        `Vehicle listing with ID ${id} not found`,
      );
    }

    return {
      message: 'Vehicle listing retrieved successfully',
      data: listing,
    };
  }

  updateListing(
    id: number,
    dto: Partial<CreateListingDto>,
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
}