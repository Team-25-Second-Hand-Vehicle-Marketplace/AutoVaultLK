import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthUserView } from '../../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../infrastructure/database/entities/dealer-profile.view-entity';
import { DealerController } from './controllers/dealer.controller';
import { DealerService } from './services/dealer.service';
import { DealerRepository } from './repositories/dealer.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuthUserView,
      DealerProfileView,
    ]),
  ],

  controllers: [
    DealerController,
  ],

  providers: [
    DealerService,
    DealerRepository,
  ],

  exports: [
    DealerService,
    DealerRepository,
  ],
})
export class DealerModule {}
