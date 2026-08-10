import { Injectable } from '@nestjs/common';
import { CreateListingDto } from '../dto/create-listing.dto';

@Injectable()
export class ListingRepository {
  private listings: any[] = [];
  private idCounter = 0;

  create(dto: CreateListingDto) {
    const listing = {
      id: ++this.idCounter,
      ...dto,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.listings.push(listing);

    return listing;
  }

  findAll() {
    return this.listings;
  }

  findById(id: number) {
    return this.listings.find(
      (listing) => listing.id === id,
    );
  }

  update(id: number, data: Partial<CreateListingDto>) {
    const listing = this.findById(id);

    if (!listing) {
      return null;
    }

    Object.assign(listing, data);

    listing.updatedAt = new Date();

    return listing;
  }

  deactivate(id: number) {
    const listing = this.findById(id);

    if (!listing) {
      return null;
    }

    listing.status = 'INACTIVE';
    listing.updatedAt = new Date();

    return listing;
  }

  createBulk(dtos: CreateListingDto[]) {
  const createdListings = dtos.map(dto => {
    const listing = {
      id: ++this.idCounter,
      ...dto,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.listings.push(listing);

    return listing;
  });

  return createdListings;
}
}