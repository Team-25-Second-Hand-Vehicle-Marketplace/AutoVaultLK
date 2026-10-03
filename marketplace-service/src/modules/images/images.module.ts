import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleImage } from '../../infrastructure/database/entities/vehicle-image.entity';
import { LocalImagesController } from './controllers/local-images.controller';
import { ImageUploadService } from './services/image-upload.service';
import { ImageUrlResolverService } from './services/image-url-resolver.service';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleImage])],
  controllers: [LocalImagesController],
  providers: [ImageUrlResolverService, ImageUploadService],
  exports: [ImageUrlResolverService, ImageUploadService],
})
export class ImagesModule {}
