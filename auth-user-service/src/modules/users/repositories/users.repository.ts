import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../infrastructure/database/entities/user.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repository: Repository<User>,
  ) {}

  findById(id: string) {
    return this.repository.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.repository.findOne({ where: { email } });
  }

  findAll() {
    return this.repository.find();
  }

  create(data: Partial<User>) {
    return this.repository.save(this.repository.create(data));
  }

  update(id: string, data: Partial<User>) {
    return this.repository.save({ id, ...data });
  }
}
