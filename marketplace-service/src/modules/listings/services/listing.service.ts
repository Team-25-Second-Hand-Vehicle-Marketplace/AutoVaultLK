import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DealerSummary } from '../../dealers/repositories/dealer.repository';
import { DealerService } from '../../dealers/services/dealer.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { ListingRepository } from '../repositories/listing.repository';
import { Vehicle } from '../../../infrastructure/database/entities/vehicle.entity';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);

  constructor(
    private readonly listingRepository: ListingRepository,
    private readonly dealerService: DealerService,
  ) {}

  /**
   * FR-13/FR-58: the owner comes from the verified JWT, never from the request
   * body. A body-supplied dealerId would let any authenticated dealer create
   * listings attributed to someone else.
   */
  async createListing(dto: CreateListingDto, actor: AuthenticatedUser) {
    await this.dealerService.getDealerById(actor.id);

    const status = dto.status ?? 'LIVE';
    const listing = await this.listingRepository.create(
      { ...dto, dealerId: actor.id },
      status,
    );

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

  async updateListing(id: string, dto: UpdateListingDto, actor: AuthenticatedUser) {
    const listing = await this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    this.assertOwnership(listing, actor);

    // dealerId is stripped rather than honoured: reassigning a listing to
    // another dealer is not an edit, and allowing it here would hand ownership
    // away with no audit trail.
    const { dealerId: _ignored, ...safe } = dto;
    const updatedListing = await this.listingRepository.update(id, safe);

    return {
      message: 'Vehicle listing updated successfully',
      data: updatedListing,
    };
  }

  async deactivateListing(id: string, actor: AuthenticatedUser) {
    const existing = await this.listingRepository.findById(id);

    if (!existing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    this.assertOwnership(existing, actor);

    const listing = await this.listingRepository.deactivate(id);

    if (!listing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    return {
      message: 'Vehicle listing deactivated successfully',
      data: listing,
    };
  }

  /**
   * FR-58: a dealer may only mutate their own listings. ADMIN is allowed
   * through so administrative tooling is not locked out of moderation.
   */
  private assertOwnership(listing: Vehicle, actor: AuthenticatedUser) {
    if (actor.role === 'ADMIN') return;

    if (listing.dealerId !== actor.id) {
      // Deliberately the same message a missing listing would produce, so this
      // cannot be used to probe which listing ids exist.
      throw new ForbiddenException('You do not have access to this listing');
    }
  }

  private async withDealer(listing: Vehicle) {
    try {
      const dealer = await this.dealerService.getDealerById(listing.dealerId);
      return { ...listing, dealer: this.toDealerPayload(dealer) };
    } catch (err) {
      // A genuinely absent dealer and a failed lookup both render as
      // `dealer: null`, so without this log the two are indistinguishable and
      // a database outage looks like missing data.
      if (err instanceof NotFoundException) {
        this.logger.warn(
          `Listing ${listing.id} references dealer ${listing.dealerId}, which no longer resolves`,
        );
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Dealer lookup failed for listing ${listing.id} (dealer ${listing.dealerId}): ${message}`,
        );
      }
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
