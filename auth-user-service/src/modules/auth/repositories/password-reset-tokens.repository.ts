import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PasswordResetToken } from '../../../infrastructure/database/entities/password-reset-token.entity';

@Injectable()
export class PasswordResetTokensRepository {
  constructor(
    @InjectRepository(PasswordResetToken)
    private readonly repository: Repository<PasswordResetToken>,
  ) {}

  findByHash(tokenHash: string) {
    return this.repository.findOne({ where: { tokenHash } });
  }

  create(data: Partial<PasswordResetToken>) {
    return this.repository.save(this.repository.create(data));
  }

  markUsed(token: PasswordResetToken, usedAt = new Date()) {
    token.usedAt = usedAt;
    return this.repository.save(token);
  }

  revokeUnusedForUser(userId: string, revokedAt = new Date()) {
    return this.repository.update(
      { userId, usedAt: IsNull() },
      { usedAt: revokedAt },
    );
  }
}
