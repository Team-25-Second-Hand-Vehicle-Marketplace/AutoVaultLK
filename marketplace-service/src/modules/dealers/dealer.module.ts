import { Module } from '@nestjs/common';
import { DealerController } from './controllers/dealer.controller';
import { DealerService } from './services/dealer.service';
import { DealerRepository } from './repositories/dealer.repository';

@Module({
  controllers: [DealerController],
  providers: [
    DealerService,
    DealerRepository,
  ],
  exports: [DealerService, DealerRepository],
})
export class DealerModule {}