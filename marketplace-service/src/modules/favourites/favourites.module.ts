import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Favourite } from '../../infrastructure/database/entities/favourite.entity';

import { FavouriteController } from './controllers/favourites.controller';
import { FavouriteService } from './services/favourite.service';
import { FavouriteRepository } from './repositories/favourite.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Favourite]),
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