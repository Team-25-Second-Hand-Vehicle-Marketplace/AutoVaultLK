import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { DealerSummary } from '../../dealers/repositories/dealer.repository';
import { DealerService } from '../../dealers/services/dealer.service';
import type { UploadedImageFile } from '../../images/services/image-upload.service';
import { ImageUploadService } from '../../images/services/image-upload.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import type { ListingSortOption } from '../dto/my-listings-query.dto';
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
    private readonly imageUploadService: ImageUploadService,
  ) {}

  async createListing(dto: CreateListingDto, actor: AuthenticatedUser) {
    const dealer = await this.dealerService.getDealerById(actor.id);
    this.assertManualUploadAllowed(dealer);

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

  /**
   * A dealer's own inventory, every status included — unlike getAllListings,
   * which is the public LIVE-only feed. This is what a dealer dashboard reads
   * to show DRAFT/PENDING_REVIEW/REJECTED listings that the public feed hides.
   *
   * `sort: 'confidence_asc'` (FR-42.1) surfaces the PENDING_REVIEW rows most
   * likely to need a correction first.
   */
  async getMyListings(actor: AuthenticatedUser, sort?: ListingSortOption) {
    const listings = await this.listingRepository.findByDealer(actor.id, sort);

    return {
      message: 'Vehicle listings retrieved successfully',
      data: listings,
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

  async updateListing(
    id: string,
    dto: UpdateListingDto,
    actor: AuthenticatedUser,
  ) {
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
   * FR-42/FR-42.1: the dealer's explicit approval that moves a PENDING_REVIEW
   * listing to LIVE. Until this existed, FR-42's "no ETL-loaded listing shall
   * become publicly visible until the owning Dealer explicitly approves it"
   * had a status describing the wait but no action ending it — a bulk upload
   * landed every row in PENDING_REVIEW and nothing in the API could move one
   * forward.
   *
   * A listing that is not PENDING_REVIEW is a 409, not a 404: the id is real
   * and the dealer may well own it, but "approve" is not a meaningful action
   * on an already-LIVE listing or a manually-created DRAFT, and the UI needs
   * to tell that apart from "this listing does not exist" to show the right
   * message.
   */
  async approveListing(id: string, actor: AuthenticatedUser) {
    const existing = await this.listingRepository.findById(id);

    if (!existing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    this.assertOwnership(existing, actor);

    if (existing.status !== 'PENDING_REVIEW') {
      throw new ConflictException(
        `Vehicle listing ${id} is ${existing.status}, not PENDING_REVIEW — nothing to approve`,
      );
    }

    const listing = await this.listingRepository.approve(id);

    if (!listing) {
      // The status check above already confirmed PENDING_REVIEW; only a race
      // with another approval/deactivation between that read and this write
      // reaches here.
      throw new ConflictException(
        `Vehicle listing ${id} is no longer PENDING_REVIEW`,
      );
    }

    return {
      message: 'Vehicle listing approved and published',
      data: listing,
    };
  }

  /**
   * FR-58: attaches photos to a listing the dealer owns. The manual listing
   * form never had an image field before this — a dealer creating one
   * vehicle at a time had no way to attach a photo at all, unlike bulk
   * upload's ZIP-of-images path.
   *
   * Replaces the vehicle's whole image set rather than appending: a dealer
   * re-submitting photos for a listing means "here is the current set", and
   * appending would leave stale images from an earlier attempt with no way
   * for the form to show which one is which.
   */
  async uploadImages(
    id: string,
    actor: AuthenticatedUser,
    files: UploadedImageFile[],
  ) {
    const listing = await this.listingRepository.findById(id);

    if (!listing) {
      throw new NotFoundException(`Vehicle listing with ID ${id} not found`);
    }

    this.assertOwnership(listing, actor);

    const images = await this.imageUploadService.replaceImages(id, files);

    return {
      message: 'Images uploaded successfully',
      data: images,
    };
  }

  /**
   * Manual, one-at-a-time listing creation is for individual dealers only.
   * Business dealers list their stock through the bulk upload pipeline
   * instead, so a stray manual listing here would bypass it.
   */
  private assertManualUploadAllowed(dealer: DealerSummary) {
    if (dealer.dealerType !== 'individual') {
      throw new ForbiddenException(
        'Business dealers must add vehicles through bulk upload, not manual listing creation',
      );
    }
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
