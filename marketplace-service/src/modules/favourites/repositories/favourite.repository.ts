import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, Repository } from 'typeorm';

import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';
import { Favourite } from '../../../infrastructure/database/entities/favourite.entity';
import { Vehicle } from '../../../infrastructure/database/entities/vehicle.entity';

@Injectable()
export class FavouriteRepository {
  constructor(
    @InjectRepository(Favourite)
    private readonly favourites: Repository<Favourite>,
    @InjectRepository(Vehicle)
    private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(AuthUserView)
    private readonly users: Repository<AuthUserView>,
  ) {}

  findByBuyerId(buyerId: string) {
    return this.favourites.find({
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
    return this.favourites.findOne({
      where: {
        buyerId,
        vehicleId,
      },
      relations: {
        vehicle: true,
      },
    });
  }

  buyerExists(buyerId: string) {
    return this.users.exists({
      where: {
        id: buyerId,
        role: 'BUYER',
        isActive: true,
      },
    });
  }

  vehicleExists(vehicleId: string) {
    return this.vehicles.exists({
      where: {
        id: vehicleId,
      },
    });
  }

  async create(
    buyerId: string,
    vehicleId: string,
  ) {
    const favourite = this.favourites.create({
      buyerId,
      vehicleId,
    });

    return this.favourites.save(favourite);
  }

  delete(
    buyerId: string,
    vehicleId: string,
  ): Promise<DeleteResult> {
    return this.favourites.delete({
      buyerId,
      vehicleId,
    });
  }
}
