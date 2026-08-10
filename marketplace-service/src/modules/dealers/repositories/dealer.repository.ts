import { Injectable } from '@nestjs/common';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Injectable()
export class DealerRepository {
  private dealers = [
    {
      id: 1,
      businessName: 'Virusan Motors',
      ownerName: 'Virusan',
      email: 'virusan@gmail.com',
      phone: '+94771234567',
      city: 'Jaffna',
      province: 'Northern',
    },
    {
      id: 2,
      businessName: 'ABC Motors',
      ownerName: 'John Silva',
      email: 'abc@gmail.com',
      phone: '+94771111111',
      city: 'Colombo',
      province: 'Western',
    },
  ];

  findProfile(id?: number) {
    if (id === undefined) {
      return this.dealers[0];
    }

    return this.findById(id);
  }

  findById(id: number) {
    return this.dealers.find(
      (dealer) => dealer.id === id,
    );
  }

  update(
    id: number,
    dto: UpdateDealerProfileDto,
  ) {
    const dealer = this.findById(id);

    if (!dealer) {
      return null;
    }

    Object.assign(dealer, dto);

    return dealer;
  }
}