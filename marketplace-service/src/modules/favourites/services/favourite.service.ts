import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { FavouriteRepository } from '../repositories/favourite.repository';

@Injectable()
export class FavouriteService {
  constructor(
    private readonly favouriteRepository: FavouriteRepository,
  ) {}

  async getFavourites(buyerId: string) {
    await this.assertBuyerExists(buyerId);

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
    await this.assertBuyerExists(buyerId);
    await this.assertVehicleExists(vehicleId);

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

    try {
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
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Vehicle is already in favourites',
        );
      }

      throw error;
    }
  }

  async removeFavourite(
    buyerId: string,
    vehicleId: string,
  ) {
    await this.assertBuyerExists(buyerId);
    await this.assertVehicleExists(vehicleId);

    const result = await this.favouriteRepository.delete(
      buyerId,
      vehicleId,
    );

    if (!result.affected) {
      throw new NotFoundException(
        'Vehicle is not in favourites',
      );
    }

    return {
      message:
        'Vehicle removed from favourites successfully',
    };
  }

  private async assertBuyerExists(buyerId: string) {
    const exists =
      await this.favouriteRepository.buyerExists(buyerId);

    if (!exists) {
      throw new NotFoundException(
        `Buyer with ID ${buyerId} not found`,
      );
    }
  }

  private async assertVehicleExists(vehicleId: string) {
    const exists =
      await this.favouriteRepository.vehicleExists(
        vehicleId,
      );

    if (!exists) {
      throw new NotFoundException(
        `Vehicle with ID ${vehicleId} not found`,
      );
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code ===
        '23505'
    );
  }
}
