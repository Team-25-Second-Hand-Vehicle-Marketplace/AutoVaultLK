import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { FavouritesService } from '../services/favourites.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

type AuthenticatedRequest = Request & {
  user: {
    id: string;
    role?: string;
  };
};

@Controller('marketplace/favourites')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FavouritesController {
  constructor(
    private readonly favouritesService: FavouritesService,
  ) {}

  @Post(':vehicleId')
  async addFavourite(
    @Param('vehicleId') vehicleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favouritesService.addFavourite(
      request.user.id,
      vehicleId,
    );
  }

  @Get()
  async getMyFavourites(
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favouritesService.getMyFavourites(
      request.user.id,
    );
  }

  @Delete(':vehicleId')
  async removeFavourite(
    @Param('vehicleId') vehicleId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favouritesService.removeFavourite(
      request.user.id,
      vehicleId,
    );
  }
}