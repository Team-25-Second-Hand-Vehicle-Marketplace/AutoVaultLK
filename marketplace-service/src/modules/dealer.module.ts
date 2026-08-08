import { Module } from '@nestjs/common';
import { DealerController } from './dealers/controllers/dealer.controller';
import { DealerService } from './dealers/services/dealer.service';

@Module({
  controllers: [DealerController],
  providers: [DealerService],
  exports: [DealerService],
})
export class DealerModule {}