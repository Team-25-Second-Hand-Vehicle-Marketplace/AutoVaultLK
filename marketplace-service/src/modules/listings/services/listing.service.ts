import { Injectable } from '@nestjs/common';

@Injectable()
export class ListingService {
  getStatus(): string {
    return 'Listing Service Ready';
  }
}