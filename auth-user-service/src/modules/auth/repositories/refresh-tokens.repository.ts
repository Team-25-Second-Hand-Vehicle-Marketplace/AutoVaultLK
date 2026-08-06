import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../../../infrastructure/database/entities/refresh-token.entity';

@Injectable()
export class RefreshTokensRepository {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly repository: Repository<RefreshToken>,
  ) {}

  findActiveByHash(tokenHash: string) {
    return this.repository.findOne({
      where: { tokenHash, revokedAt: IsNull() },
    });
  }

  create(data: Partial<RefreshToken>) {
    return this.repository.save(this.repository.create(data));
  }

  revoke(token: RefreshToken, revokedAt = new Date()) {
    token.revokedAt = revokedAt;
    return this.repository.save(token);
  }
}
