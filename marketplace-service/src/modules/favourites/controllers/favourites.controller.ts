import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../../common/types/jwt-payload.type';
import { FavouriteService } from '../services/favourite.service';

@UseGuards(JwtAuthGuard)
@Controller('marketplace/favourites')
export class FavouriteController {
  constructor(
    private readonly favouriteService: FavouriteService,
  ) {}

  @Get()
  getFavourites(@Req() req: AuthenticatedRequest) {
    return this.favouriteService.getFavourites(
      req.user.userId,
    );
  }

  @Post(':vehicleId')
  addFavourite(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.favouriteService.addFavourite(
      req.user.userId,
      vehicleId,
    );
  }

  @Delete(':vehicleId')
  removeFavourite(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.favouriteService.removeFavourite(
      req.user.userId,
      vehicleId,
    );
  }
}
