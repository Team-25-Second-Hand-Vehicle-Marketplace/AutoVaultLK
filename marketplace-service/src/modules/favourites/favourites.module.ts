import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthUserView } from '../../infrastructure/database/entities/auth-user.view-entity';
import { Favourite } from '../../infrastructure/database/entities/favourite.entity';
import { Vehicle } from '../../infrastructure/database/entities/vehicle.entity';

import { FavouriteController } from './controllers/favourites.controller';
import { FavouriteService } from './services/favourite.service';
import { FavouriteRepository } from './repositories/favourite.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuthUserView,
      Favourite,
      Vehicle,
    ]),
  ],

  controllers: [
    FavouriteController,
  ],

  providers: [
    FavouriteService,
    FavouriteRepository,
  ],

  exports: [
    FavouriteService,
  ],
})
export class FavouritesModule {}
