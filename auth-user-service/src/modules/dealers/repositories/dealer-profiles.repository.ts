import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DealerProfile } from '../../../infrastructure/database/entities/dealer-profile.entity';

@Injectable()
export class DealerProfilesRepository {
  constructor(
    @InjectRepository(DealerProfile)
    private readonly repository: Repository<DealerProfile>,
  ) {}

  findByUserId(userId: string) {
    return this.repository.findOne({ where: { userId } });
  }

  findAll() {
    return this.repository.find();
  }

  create(data: Partial<DealerProfile>) {
    return this.repository.save(this.repository.create(data));
  }

  update(userId: string, data: Partial<DealerProfile>) {
    return this.repository.save({ userId, ...data });
  }
}
