import { Injectable, NotFoundException } from '@nestjs/common';
import { DealerRepository } from '../repositories/dealer.repository';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Injectable()
export class DealerService {
  constructor(
    private readonly dealerRepository: DealerRepository,
  ) {}

  getProfile(id: number) {
    const dealer = this.dealerRepository.findById(id);

    if (!dealer) {
      throw new NotFoundException(
        `Dealer with ID ${id} not found`,
      );
    }

    return dealer;
  }

  getDealerById(id: number) {
    const dealer = this.dealerRepository.findById(id);

    if (!dealer) {
      throw new NotFoundException(
        `Dealer with ID ${id} not found`,
      );
    }

    return dealer;
  }

  updateProfile(id: number, dto: UpdateDealerProfileDto) {
    const updatedDealer = this.dealerRepository.update(id, dto);

    if (!updatedDealer) {
      throw new NotFoundException(
        `Dealer with ID ${id} not found`,
      );
    }

    return {
      message: 'Dealer profile updated successfully',
      data: updatedDealer,
    };
  }
}