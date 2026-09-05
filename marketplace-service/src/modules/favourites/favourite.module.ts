import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Favourite } from '../../infrastructure/database/entities/favourite.entity';

import { FavouritesController } from './controllers/favourites.controller';
import { FavouritesRepository } from './repositories/favourites.repository';
import { FavouritesService } from './services/favourites.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Favourite,
    ]),
  ],

  controllers: [
    FavouritesController,
  ],

  providers: [
    FavouritesRepository,
    FavouritesService,
  ],

  exports: [
    FavouritesService,
  ],
})
export class FavouritesModule {}