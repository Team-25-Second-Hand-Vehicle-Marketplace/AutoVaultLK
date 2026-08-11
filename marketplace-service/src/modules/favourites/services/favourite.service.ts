import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { FavouriteRepository } from '../repositories/favourite.repository';

@Injectable()
export class FavouriteService {
  constructor(
    private readonly favouriteRepository: FavouriteRepository,
  ) {}

  async getFavourites(buyerId: string) {
    const favourites =
      await this.favouriteRepository.findByBuyerId(
        buyerId,
      );

    return {
      message: 'Favourites retrieved successfully',
      data: favourites,
    };
  }

  async addFavourite(
    buyerId: string,
    vehicleId: string,
  ) {
    const existing =
      await this.favouriteRepository.findByBuyerAndVehicle(
        buyerId,
        vehicleId,
      );

    if (existing) {
      throw new ConflictException(
        'Vehicle is already in favourites',
      );
    }

    const favourite =
      await this.favouriteRepository.create(
        buyerId,
        vehicleId,
      );

    return {
      message:
        'Vehicle added to favourites successfully',
      data: favourite,
    };
  }

  async removeFavourite(
    buyerId: string,
    vehicleId: string,
  ) {
    const favourite =
      await this.favouriteRepository.delete(
        buyerId,
        vehicleId,
      );

    if (!favourite) {
      throw new NotFoundException(
        'Vehicle is not in favourites',
      );
    }

    return {
      message:
        'Vehicle removed from favourites successfully',
      data: favourite,
    };
  }
}