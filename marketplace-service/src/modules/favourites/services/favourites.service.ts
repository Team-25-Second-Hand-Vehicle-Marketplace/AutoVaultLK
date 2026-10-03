import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { ImageUrlResolverService } from '../../images/services/image-url-resolver.service';
import { FavouritesRepository } from '../repositories/favourites.repository';

@Injectable()
export class FavouritesService {
  constructor(
    private readonly favouritesRepository: FavouritesRepository,
    private readonly imageUrlResolver: ImageUrlResolverService,
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

  /**
   * The buyer's saved vehicles, newest first, each with its photo.
   *
   * The joined vehicle is the raw entity, which has no image URLs - search and
   * recommendations resolve them from vehicle_images, and without the same step
   * here every saved card showed "No photos yet". `imageUrl` and `thumbnailUrl`
   * are added the same way those modules add them (and stay `null` for a
   * vehicle with no photo, which is what makes the card fall back to its
   * placeholder).
   */
  async getMyFavourites(buyerId: string) {
    const favourites = await this.favouritesRepository.findByBuyer(
      buyerId,
    );

    const vehicleIds = favourites
      .filter((favourite) => favourite.vehicle)
      .map((favourite) => favourite.vehicleId);
    if (vehicleIds.length === 0) return favourites;

    const images =
      await this.favouritesRepository.findPrimaryImagePaths(vehicleIds);

    return Promise.all(
      favourites.map(async (favourite) => {
        if (!favourite.vehicle) return favourite;

        const image = images.get(favourite.vehicleId);
        const [imageUrl, thumbnailUrl] = await Promise.all([
          this.imageUrlResolver.resolve(image?.imagePath ?? null),
          this.imageUrlResolver.resolve(image?.thumbnailPath ?? null),
        ]);

        return {
          ...favourite,
          vehicle: { ...favourite.vehicle, imageUrl, thumbnailUrl },
        };
      }),
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