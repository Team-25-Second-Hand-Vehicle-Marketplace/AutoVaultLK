import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Favourite } from '../../infrastructure/database/entities/favourite.entity';

import { FavouritesController } from './controllers/favourites.controller';
import { FavouritesRepository } from './repositories/favourites.repository';
import { FavouritesService } from './services/favourites.service';
import { JwtAuthModule } from '../auth/jwt-auth.module';

@Module({
  // FavouritesController is class-level @UseGuards(JwtAuthGuard, RolesGuard).
  // Guards named by class resolve against the declaring module, so this import
  // is what makes them work here rather than by accident.
  imports: [
    TypeOrmModule.forFeature([
      Favourite,
    ]),
    JwtAuthModule,
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