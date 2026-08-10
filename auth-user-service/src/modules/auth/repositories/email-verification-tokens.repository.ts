import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EmailVerificationToken } from '../../../infrastructure/database/entities/email-verification-token.entity';

@Injectable()
export class EmailVerificationTokensRepository {
  constructor(
    @InjectRepository(EmailVerificationToken)
    private readonly repository: Repository<EmailVerificationToken>,
  ) {}

  findByHash(tokenHash: string) {
    return this.repository.findOne({ where: { tokenHash } });
  }

  create(data: Partial<EmailVerificationToken>) {
    return this.repository.save(this.repository.create(data));
  }

  markUsed(token: EmailVerificationToken, usedAt = new Date()) {
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
