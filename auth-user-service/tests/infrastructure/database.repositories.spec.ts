import { Repository } from 'typeorm';
import { RefreshToken } from '../../src/infrastructure/database/entities/refresh-token.entity';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import { RefreshTokensRepository } from '../../src/modules/auth/repositories/refresh-tokens.repository';
import { UsersRepository } from '../../src/modules/users/repositories/users.repository';

describe('Database repositories', () => {
  it('creates users through the TypeORM repository', async () => {
    const entity = { id: 'user-id' } as User;
    const typeormRepository = {
      create: jest.fn().mockReturnValue(entity),
      save: jest.fn().mockResolvedValue(entity),
    } as unknown as Repository<User>;

    await new UsersRepository(typeormRepository).create({
      email: 'user@test.com',
    });

    expect(typeormRepository.create).toHaveBeenCalledWith({
      email: 'user@test.com',
    });
    expect(typeormRepository.save).toHaveBeenCalledWith(entity);
  });

  it('revokes refresh tokens through the TypeORM repository', async () => {
    const token = { revokedAt: null } as RefreshToken;
    const typeormRepository = {
      save: jest.fn().mockResolvedValue(token),
    } as unknown as Repository<RefreshToken>;
    const repository = new RefreshTokensRepository(typeormRepository);
    const revokedAt = new Date('2026-08-06T00:00:00.000Z');

    await repository.revoke(token, revokedAt);

    expect(token.revokedAt).toBe(revokedAt);
    expect(typeormRepository.save).toHaveBeenCalledWith(token);
  });
});
