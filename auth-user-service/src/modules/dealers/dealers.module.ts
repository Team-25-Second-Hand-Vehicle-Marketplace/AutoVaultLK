import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfile } from '../../infrastructure/database/entities/dealer-profile.entity';
import { DealerProfilesController } from './controllers/dealer-profiles.controller';
import { DealerProfilesRepository } from './repositories/dealer-profiles.repository';
import { DealerProfilesService } from './services/dealer-profiles.service';

@Module({
  imports: [TypeOrmModule.forFeature([DealerProfile])],
  controllers: [DealerProfilesController],
  providers: [DealerProfilesRepository, DealerProfilesService],
  exports: [DealerProfilesRepository, DealerProfilesService],
})
export class DealerProfilesModule {}
