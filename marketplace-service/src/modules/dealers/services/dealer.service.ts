import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';
import { DealerRepository } from '../repositories/dealer.repository';

@Injectable()
export class DealerService {
  constructor(
    private readonly dealerRepository: DealerRepository,
  ) {}

  async getProfile(id: string) {
    const dealer =
      await this.dealerRepository.findById(id);

    if (!dealer) {
      throw new NotFoundException(
        `Dealer with ID ${id} not found`,
      );
    }

    return {
      message: 'Dealer profile retrieved successfully',
      data: dealer,
    };
  }

  async getDealerById(id: string) {
    const dealer =
      await this.dealerRepository.findById(id);

    if (!dealer) {
      throw new NotFoundException(
        `Dealer with ID ${id} not found`,
      );
    }

    return dealer;
  }

  async getDealersByIds(ids: string[]) {
    return this.dealerRepository.findByIds(ids);
  }

  async assertDealerExists(id: string) {
    const exists = await this.dealerRepository.exists(id);

    if (!exists) {
      throw new NotFoundException(
        `Dealer with ID ${id} not found`,
      );
    }
  }

  updateProfile(
    id: string,
    _dto: UpdateDealerProfileDto,
  ) {
    void id;

    throw new BadRequestException(
      'Dealer profiles are owned by auth-user-service and cannot be updated from marketplace-service.',
    );
  }
}
