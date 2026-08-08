import { Injectable } from '@nestjs/common';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Injectable()
export class DealerRepository {
  private dealer = {
    id: 1,
    businessName: 'ABC Motors',
    ownerName: 'John Silva',
    email: 'abc@gmail.com',
    phone: '+94771234567',
    address: 'No.12, Main Street',
    city: 'Colombo',
    province: 'Western',
    profileImage: 'dealer.png',
  };

  findProfile() {
    return this.dealer;
  }

  findById(id: number) {
    return {
      ...this.dealer,
      id,
    };
  }

  update(dto: UpdateDealerProfileDto) {
    this.dealer = {
      ...this.dealer,
      ...dto,
    };

    return this.dealer;
  }
}