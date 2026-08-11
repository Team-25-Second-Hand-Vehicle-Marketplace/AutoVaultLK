import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';

import { FavouriteService } from '../services/favourite.service';

@Controller('marketplace/favourites')
export class FavouriteController {
  constructor(
    private readonly favouriteService: FavouriteService,
  ) {}

  @Get()
  getFavourites() {
    // Temporary buyer UUID.
    // Replace this with the authenticated user's UUID later.
    const buyerId =
      '00000000-0000-0000-0000-000000000001';

    return this.favouriteService.getFavourites(
      buyerId,
    );
  }

  @Post(':vehicleId')
  addFavourite(
    @Param('vehicleId') vehicleId: string,
  ) {
    // Temporary buyer UUID.
    const buyerId =
      '00000000-0000-0000-0000-000000000001';

    return this.favouriteService.addFavourite(
      buyerId,
      vehicleId,
    );
  }

  @Delete(':vehicleId')
  removeFavourite(
    @Param('vehicleId') vehicleId: string,
  ) {
    // Temporary buyer UUID.
    const buyerId =
      '00000000-0000-0000-0000-000000000001';

    return this.favouriteService.removeFavourite(
      buyerId,
      vehicleId,
    );
  }
}