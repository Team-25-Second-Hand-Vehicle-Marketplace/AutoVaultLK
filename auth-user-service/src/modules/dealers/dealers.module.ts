import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfile } from '../../infrastructure/database/entities/dealer-profile.entity';
import { DealerProfilesController } from './controllers/dealer-profiles.controller';
import { InternalDealersController } from './controllers/internal-dealers.controller';
import { DealerProfilesRepository } from './repositories/dealer-profiles.repository';
import { DealerProfilesService } from './services/dealer-profiles.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([DealerProfile]), UsersModule],
  controllers: [DealerProfilesController, InternalDealersController],
  providers: [DealerProfilesRepository, DealerProfilesService],
  exports: [DealerProfilesRepository, DealerProfilesService],
})
export class DealerProfilesModule {}
