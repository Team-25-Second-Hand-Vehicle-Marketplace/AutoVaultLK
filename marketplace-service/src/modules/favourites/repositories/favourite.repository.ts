import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Favourite } from '../../../infrastructure/database/entities/favourite.entity';

@Injectable()
export class FavouriteRepository {
  constructor(
    @InjectRepository(Favourite)
    private readonly repository: Repository<Favourite>,
  ) {}

  findByBuyerId(buyerId: string) {
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

  findByBuyerAndVehicle(
    buyerId: string,
    vehicleId: string,
  ) {
    return this.repository.findOne({
      where: {
        buyerId,
        vehicleId,
      },
    });
  }

  create(
    buyerId: string,
    vehicleId: string,
  ) {
    const favourite = this.repository.create({
      buyerId,
      vehicleId,
    });

    return this.repository.save(favourite);
  }

  async delete(
    buyerId: string,
    vehicleId: string,
  ) {
    const favourite =
      await this.findByBuyerAndVehicle(
        buyerId,
        vehicleId,
      );

    if (!favourite) {
      return null;
    }

    await this.repository.remove(favourite);

    return favourite;
  }
}