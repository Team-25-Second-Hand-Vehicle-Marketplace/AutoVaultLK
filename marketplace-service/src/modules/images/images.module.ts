import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleImage } from '../../infrastructure/database/entities/vehicle-image.entity';
import { LocalImagesController } from './controllers/local-images.controller';
import { ImageUploadService } from './services/image-upload.service';
import { ImageUrlResolverService } from './services/image-url-resolver.service';

/**
 * NFR-19's signed-URL requirement, plus the two dev-time fallbacks
 * IMAGE_SERVE_MODE offers (see image-serve.config.ts). Exports both
 * services: ImageUrlResolverService so SearchModule/RecommendationsModule
 * can resolve stored paths into fetchable URLs, ImageUploadService so
 * ListingModule can give the manual listing form (FR-58) a way to attach
 * photos it never had.
 */
@Module({
  imports: [TypeOrmModule.forFeature([VehicleImage])],
  controllers: [LocalImagesController],
  providers: [ImageUrlResolverService, ImageUploadService],
  exports: [ImageUrlResolverService, ImageUploadService],
})
export class ImagesModule {}
