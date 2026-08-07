import { Controller, Get } from '@nestjs/common';
import { DealerService } from '../services/dealer.service';

@Controller('dealers')
export class DealerController {
  constructor(private readonly dealerService: DealerService) {}

  @Get('status')
  getStatus() {
    return {
      module: 'Dealers',
      status: this.dealerService.getStatus(),
    };
  }
}