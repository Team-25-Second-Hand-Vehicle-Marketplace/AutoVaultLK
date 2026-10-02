import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Favourite } from '../../infrastructure/database/entities/favourite.entity';

import { FavouritesController } from './controllers/favourites.controller';
import { FavouritesRepository } from './repositories/favourites.repository';
import { FavouritesService } from './services/favourites.service';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { ImageUrlResolverService } from '../images/services/image-url-resolver.service';

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

  // ImageUrlResolverService is provided here directly rather than by importing
  // ImagesModule: it needs only ConfigService, and ImagesModule would also pull
  // in its TypeORM feature registration and upload controller for no benefit.
  providers: [
    FavouritesRepository,
    FavouritesService,
    ImageUrlResolverService,
  ],

  exports: [
    FavouritesService,
  ],
})
export class FavouritesModule {}