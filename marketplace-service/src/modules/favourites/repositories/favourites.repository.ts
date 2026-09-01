import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Favourite } from '../../../infrastructure/database/entities/favourite.entity';

@Injectable()
export class FavouritesRepository {
  constructor(
    @InjectRepository(Favourite)
    private readonly repository: Repository<Favourite>,
  ) {}

  async createFavourite(
    buyerId: string,
    vehicleId: string,
  ): Promise<Favourite> {
    const favourite = this.repository.create({
      buyerId,
      vehicleId,
    });

    return this.repository.save(favourite);
  }

  async findFavourite(
    buyerId: string,
    vehicleId: string,
  ): Promise<Favourite | null> {
    return this.repository.findOne({
      where: {
        buyerId,
        vehicleId,
      },
    });
  }

  async findByBuyer(
    buyerId: string,
  ): Promise<Favourite[]> {
    return this.repository.find({
      where: {
        buyerId,
      },
      relations: {
        vehicle: true,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async deleteFavourite(
    buyerId: string,
    vehicleId: string,
  ): Promise<void> {
    await this.repository.delete({
      buyerId,
      vehicleId,
    });
  }
}