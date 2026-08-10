import { Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UsersRepository } from '../repositories/users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findAll() {
    return this.usersRepository.findAll();
  }

  async findById(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} was not found`);
    }
    return user;
  }

  findByEmail(email: string) {
    return this.usersRepository.findByEmail(email);
  }

  async create(data: CreateUserDto) {
    const created = await this.usersRepository.create({
      email: data.email,
      name: data.name,
      passwordHash: await bcrypt.hash(data.password, 12),
      role: 'BUYER',
    });
    return this.findById(created.id);
  }

  async update(id: string, data: UpdateUserDto) {
    await this.findById(id);
    return this.usersRepository.update(id, data);
  }
}
