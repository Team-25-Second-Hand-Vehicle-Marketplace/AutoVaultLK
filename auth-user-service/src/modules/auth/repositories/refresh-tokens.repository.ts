import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { RefreshToken } from '../../../infrastructure/database/entities/refresh-token.entity';

@Injectable()
export class RefreshTokensRepository {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repository: Repository<RefreshToken>,
  ) {}

  findByHash(tokenHash: string) {
    return this.repository.findOne({ where: { tokenHash } });
  }

  findActiveByHash(tokenHash: string) {
    return this.repository.findOne({
      where: { tokenHash, revokedAt: IsNull() },
    });
  }

  countActiveByUserId(userId: string) {
    return this.repository.count({
      where: {
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
  }

  create(data: Partial<RefreshToken>) {
    return this.repository.save(this.repository.create(data));
  }

  revoke(token: RefreshToken, revokedAt = new Date()) {
    token.revokedAt = revokedAt;
    return this.repository.save(token);
  }

  async revokeOldestActiveSessions(userId: string, count: number) {
    if (count <= 0) {
      return;
    }

    const tokens = await this.repository.find({
      where: {
        userId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'ASC' },
      take: count,
    });

    if (!tokens.length) {
      return;
    }

    const revokedAt = new Date();
    for (const token of tokens) {
      token.revokedAt = revokedAt;
    }

    await this.repository.save(tokens);
  }

  revokeAllActiveForUser(userId: string, revokedAt = new Date()) {
    return this.repository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt },
    );
  }

  revokeFamily(familyId: string, revokedAt = new Date()) {
    return this.repository.update(
      { familyId, revokedAt: IsNull() },
      { revokedAt },
    );
  }
}
