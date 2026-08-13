import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfile } from '../../infrastructure/database/entities/dealer-profile.entity';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { DealerProfilesController } from './controllers/dealer-profiles.controller';
import { InternalDealersController } from './controllers/internal-dealers.controller';
import { DealerProfilesRepository } from './repositories/dealer-profiles.repository';
import { DealerProfilesService } from './services/dealer-profiles.service';
import { UsersModule } from '../users/users.module';

/**
 * UsersModule is imported for UsersRepository only. UsersModule does not
 * import DealersModule, so this is not a circular dependency.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DealerProfile]), UsersModule, JwtAuthModule],
  controllers: [DealerProfilesController, InternalDealersController],
  providers: [DealerProfilesRepository, DealerProfilesService],
  exports: [DealerProfilesRepository, DealerProfilesService],
})
export class DealerProfilesModule {}
