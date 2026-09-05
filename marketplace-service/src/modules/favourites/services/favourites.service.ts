import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { FavouritesRepository } from '../repositories/favourites.repository';

@Injectable()
export class FavouritesService {
  constructor(
    private readonly favouritesRepository: FavouritesRepository,
  ) {}

  async addFavourite(
    buyerId: string,
    vehicleId: string,
  ) {
    const existing =
      await this.favouritesRepository.findFavourite(
        buyerId,
        vehicleId,
      );

    if (existing) {
      throw new ConflictException(
        'Vehicle is already in favourites',
      );
    }

    return this.favouritesRepository.createFavourite(
      buyerId,
      vehicleId,
    );
  }

  async getMyFavourites(buyerId: string) {
    return this.favouritesRepository.findByBuyer(
      buyerId,
    );
  }

  async removeFavourite(
    buyerId: string,
    vehicleId: string,
  ) {
    const existing =
      await this.favouritesRepository.findFavourite(
        buyerId,
        vehicleId,
      );

    if (!existing) {
      throw new NotFoundException(
        'Favourite not found',
      );
    }

    await this.favouritesRepository.deleteFavourite(
      buyerId,
      vehicleId,
    );

    return {
      message: 'Vehicle removed from favourites',
    };
  }
}