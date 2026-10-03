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