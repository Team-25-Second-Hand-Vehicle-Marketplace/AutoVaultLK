import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';

import { CreateFavouriteDto } from '../dto/create-favourite.dto';
import { FavouriteService } from '../services/favourite.service';

@Controller('marketplace/favourites')
export class FavouriteController {
  constructor(
    private readonly favouriteService: FavouriteService,
  ) {}

  @Get()
  getFavourites(
    @Query('buyerId', ParseUUIDPipe) buyerId: string,
  ) {
    return this.favouriteService.getFavourites(
      buyerId,
    );
  }

  @Post(':vehicleId')
  addFavourite(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: CreateFavouriteDto,
  ) {
    return this.favouriteService.addFavourite(
      dto.buyerId,
      vehicleId,
    );
  }

  @Delete(':vehicleId')
  removeFavourite(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: CreateFavouriteDto,
  ) {
    return this.favouriteService.removeFavourite(
      dto.buyerId,
      vehicleId,
    );
  }
}
