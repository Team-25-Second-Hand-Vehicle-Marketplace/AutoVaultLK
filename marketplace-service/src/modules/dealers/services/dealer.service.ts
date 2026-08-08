import { Injectable } from '@nestjs/common';
import { DealerRepository } from '../repositories/dealer.repository';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Injectable()
export class DealerService {
  constructor(
    private readonly dealerRepository: DealerRepository,
  ) {}

  getProfile() {
    return this.dealerRepository.findProfile();
  }

  getDealerById(id: number) {
    return this.dealerRepository.findById(id);
  }

  updateProfile(dto: UpdateDealerProfileDto) {
    const updatedDealer = this.dealerRepository.update(dto);

    return {
      message: 'Dealer profile updated successfully',
      data: updatedDealer,
    };
  }
}