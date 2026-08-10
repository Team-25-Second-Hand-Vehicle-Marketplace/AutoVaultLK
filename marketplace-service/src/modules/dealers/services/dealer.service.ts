import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';

import { DealerRepository } from '../repositories/dealer.repository';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Injectable()
export class DealerService {
  constructor(
    private readonly dealerRepository: DealerRepository,
  ) {}

  async getProfile(id: string) {
    const dealer = await this.dealerRepository.findById(id);

    if (!dealer) {
      throw new NotFoundException(`Dealer with ID ${id} not found`);
    }

    return dealer;
  }

  async getDealerById(id: string) {
    return this.getProfile(id);
  }

  updateProfile(_id: string, _dto: UpdateDealerProfileDto) {
    throw new NotImplementedException(
      'Dealer profile updates are owned by auth-user-service',
    );
  }
}
