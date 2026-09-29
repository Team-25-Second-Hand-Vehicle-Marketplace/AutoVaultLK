import { DataSource } from 'typeorm';
import { UsersRepository } from '../../src/modules/users/repositories/users.repository';
import { User } from '../../src/infrastructure/database/entities/user.entity';
import {
  connect,
  createFixtureUser,
  describeWithDatabase,
  disconnect,
  fixtureEmail,
  repositoryFor,
} from './test-database';

describeWithDatabase('UsersRepository (integration)', () => {
  let ds: DataSource;
  let repository: UsersRepository;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    repository = new UsersRepository(repositoryFor(ds, User));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await ds.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [createdUserIds]);
    }
    await disconnect();
  });

  const fixtureUser = async (overrides: Partial<User> = {}) => {
    const user = await createFixtureUser(ds, overrides);
    createdUserIds.push(user.id);
    return user;
  };

  describe('email uniqueness', () => {
    it('rejects a second user with the same email', async () => {
      const email = fixtureEmail('dup');
      await repository.create({
        email,
        passwordHash: 'hash-one',
        name: 'First',
        role: 'BUYER',
      });
      createdUserIds.push((await repository.findByEmail(email))!.id);

      await expect(
        repository.create({
          email,
          passwordHash: 'hash-two',
          name: 'Second',
          role: 'BUYER',
        }),
      ).rejects.toThrow();
    });
  });

  describe('findByEmail / findById', () => {
    it('round-trips a created user by email and by id', async () => {
      const user = await fixtureUser();

      const byEmail = await repository.findByEmail(user.email);
      const byId = await repository.findById(user.id);

      expect(byEmail?.id).toBe(user.id);
      expect(byId?.id).toBe(user.id);
    });

    it('returns null for an unknown id', async () => {
      const found = await repository.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('recordFailedLogin / clearLoginFailures', () => {
    it('increments failedLoginAttempts without locking below the threshold', async () => {
      const user = await fixtureUser();

      const result = await repository.recordFailedLogin(user.id, 5, 15);

      expect(result.failedLoginAttempts).toBe(1);
      expect(result.lockedUntil).toBeNull();

      const reloaded = await repository.findById(user.id);
      expect(reloaded!.failedLoginAttempts).toBe(1);
    });

    it('locks the account once the attempt count reaches maxAttempts', async () => {
      const user = await fixtureUser();

      let result;
      for (let i = 0; i < 3; i++) {
        result = await repository.recordFailedLogin(user.id, 3, 15);
      }

      expect(result!.failedLoginAttempts).toBe(3);
      expect(result!.lockedUntil).not.toBeNull();
      expect(result!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      const reloaded = await repository.findById(user.id);
      expect(reloaded!.lockedUntil).not.toBeNull();
    });

    it('clearLoginFailures resets the counter and lock', async () => {
      const user = await fixtureUser();
      await repository.recordFailedLogin(user.id, 2, 15);
      await repository.recordFailedLogin(user.id, 2, 15);

      await repository.clearLoginFailures(user.id);

      const reloaded = await repository.findById(user.id);
      expect(reloaded!.failedLoginAttempts).toBe(0);
      expect(reloaded!.lockedUntil).toBeNull();
    });

    it('recordFailedLogin on an unknown user returns a zeroed result without throwing', async () => {
      const result = await repository.recordFailedLogin(
        '00000000-0000-0000-0000-000000000000',
        5,
        15,
      );
      expect(result).toEqual({ failedLoginAttempts: 0, lockedUntil: null });
    });
  });
});
