import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateDealerProfileDto } from '../dto/create-dealer-profile.dto';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';
import { DealerProfilesRepository } from '../repositories/dealer-profiles.repository';

@Injectable()
export class DealerProfilesService {
  constructor(
    private readonly dealerProfilesRepository: DealerProfilesRepository,
  ) {}

  findAll() {
    return this.dealerProfilesRepository.findAll();
  }

  async findByUserId(userId: string) {
    const profile = await this.dealerProfilesRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException(
        `Dealer profile for user ${userId} was not found`,
      );
    }
    return profile;
  }

  create(data: CreateDealerProfileDto) {
    return this.dealerProfilesRepository.create(data);
  }

  async update(userId: string, data: UpdateDealerProfileDto) {
    await this.findByUserId(userId);
    return this.dealerProfilesRepository.update(userId, data);
  }
}
