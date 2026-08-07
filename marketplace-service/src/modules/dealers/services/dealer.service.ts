import { Injectable } from '@nestjs/common';

@Injectable()
export class DealerService {
  getStatus(): string {
    return 'Dealer Service Ready';
  }
}