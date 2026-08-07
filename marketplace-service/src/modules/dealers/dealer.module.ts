import { Module } from '@nestjs/common';
import { DealerController } from './controllers/dealer.controller';
import { DealerService } from './services/dealer.service';

@Module({
  controllers: [DealerController],
  providers: [DealerService],
  exports: [DealerService],
})
export class DealerModule {}