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

  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockoutMinutes: number,
  ) {
    const user = await this.findById(userId);
    if (!user) {
      return { failedLoginAttempts: 0, lockedUntil: null as Date | null };
    }

    const failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil =
      failedLoginAttempts >= maxAttempts
        ? new Date(Date.now() + lockoutMinutes * 60_000)
        : user.lockedUntil;

    await this.repository.update(userId, { failedLoginAttempts, lockedUntil });
    return { failedLoginAttempts, lockedUntil };
  }

  clearLoginFailures(userId: string) {
    return this.repository.update(userId, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }
}
