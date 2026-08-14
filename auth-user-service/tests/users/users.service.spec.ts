import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../../src/modules/users/services/users.service';

describe('UsersService', () => {
  const usersRepository = {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const service = new UsersService(usersRepository as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns a sanitized user by id', async () => {
    const user = {
      id: 'user-id',
      email: 'user@test.com',
      passwordHash: 'secret-hash',
      failedLoginAttempts: 2,
      lockedUntil: null,
    };
    usersRepository.findById.mockResolvedValue(user);

    await expect(service.findById('user-id')).resolves.toEqual({
      id: 'user-id',
      email: 'user@test.com',
    });
  });

  it('throws when a user does not exist', async () => {
    usersRepository.findById.mockResolvedValue(null);

    await expect(service.findById('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delegates user updates to the repository', async () => {
    usersRepository.findById.mockResolvedValue({ id: 'user-id' });
    usersRepository.update.mockResolvedValue({ id: 'user-id', name: 'Updated' });

    await service.update('user-id', { name: 'Updated' });

    expect(usersRepository.update).toHaveBeenCalledWith('user-id', {
      name: 'Updated',
    });
  });
});
