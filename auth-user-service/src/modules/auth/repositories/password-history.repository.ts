import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasswordHistory } from '../../../infrastructure/database/entities/password-history.entity';

@Injectable()
export class PasswordHistoryRepository {
  constructor(
    @InjectRepository(PasswordHistory)
    private readonly repository: Repository<PasswordHistory>,
  ) {}

  findRecentForUser(userId: string, limit: number) {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  create(userId: string, passwordHash: string) {
    return this.repository.save(
      this.repository.create({ userId, passwordHash }),
    );
  }

  async trimToLimit(userId: string, limit: number) {
    const entries = await this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const stale = entries.slice(limit);
    if (!stale.length) {
      return;
    }

    await this.repository.remove(stale);
  }
}
