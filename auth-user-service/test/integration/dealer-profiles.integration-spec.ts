import { DataSource } from 'typeorm';
import { DealerProfilesRepository } from '../../src/modules/dealers/repositories/dealer-profiles.repository';
import {
  DealerProfile,
  DealerType,
  VerificationStatus,
} from '../../src/infrastructure/database/entities/dealer-profile.entity';
import {
  connect,
  createFixtureUser,
  deleteFixtureUser,
  describeWithDatabase,
  disconnect,
  repositoryFor,
} from './test-database';

describeWithDatabase('DealerProfilesRepository (integration)', () => {
  let ds: DataSource;
  let repository: DealerProfilesRepository;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const connection = await connect();
    if (!connection)
      throw new Error('Database became unreachable after the probe');
    ds = connection;
    repository = new DealerProfilesRepository(repositoryFor(ds, DealerProfile));
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await ds.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [createdUserIds]);
    }
    await disconnect();
  });

  const fixtureDealerUser = async () => {
    const user = await createFixtureUser(ds, { role: 'DEALER' });
    createdUserIds.push(user.id);
    return user;
  };

  const create = (userId: string, overrides: Partial<DealerProfile> = {}) =>
    repository.create({
      userId,
      dealerType: DealerType.INDIVIDUAL,
      businessRegistrationNumber: 'REG-0001',
      businessAddress: '1 Test Road',
      city: 'Colombo',
      verificationDocuments: { nic: 'https://example.test/nic.pdf' },
      companyName: 'Integration Test Motors',
      contactNumber: null,
      verificationStatus: VerificationStatus.PENDING,
      ...overrides,
    });

  describe('the enum columns (dealer_type, verification_status)', () => {
    it('persists and reads back a native Postgres enum value', async () => {
      const user = await fixtureDealerUser();
      await create(user.id, { dealerType: DealerType.BUSINESS });

      const found = await repository.findByUserId(user.id);

      expect(found!.dealerType).toBe(DealerType.BUSINESS);
      expect(found!.verificationStatus).toBe(VerificationStatus.PENDING);
    });

    it('rejects a value outside the enum at the database level', async () => {
      const user = await fixtureDealerUser();

      await expect(
        ds.query(
          `INSERT INTO auth.dealer_profiles
             (user_id, dealer_type, business_registration_number, business_address, city, verification_documents, company_name)
           VALUES ($1, 'not_a_real_type', 'REG', 'Addr', 'City', '{}'::jsonb, 'Co')`,
          [user.id],
        ),
      ).rejects.toThrow();
    });
  });

  describe('findByUserId', () => {
    it('round-trips a created profile keyed by user_id', async () => {
      const user = await fixtureDealerUser();
      await create(user.id, { companyName: 'Round Trip Motors' });

      const found = await repository.findByUserId(user.id);

      expect(found?.companyName).toBe('Round Trip Motors');
    });

    it('returns null for a user with no dealer profile', async () => {
      const found = await repository.findByUserId('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  describe('update', () => {
    it('applies a verification decision (verifiedBy, verifiedAt, status)', async () => {
      const user = await fixtureDealerUser();
      await create(user.id);
      const verifiedAt = new Date();
      const adminUser = await fixtureDealerUser();

      await repository.update(user.id, {
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedBy: adminUser.id,
        verifiedAt,
      });

      const found = await repository.findByUserId(user.id);
      expect(found!.verificationStatus).toBe(VerificationStatus.VERIFIED);
      expect(found!.verifiedBy).toBe(adminUser.id);
      expect(found!.verifiedAt?.getTime()).toBe(verifiedAt.getTime());
    });

    it('records a rejection reason', async () => {
      const user = await fixtureDealerUser();
      await create(user.id);

      await repository.update(user.id, {
        verificationStatus: VerificationStatus.REJECTED,
        rejectionReason: 'Business registration number could not be verified',
      });

      const found = await repository.findByUserId(user.id);
      expect(found!.verificationStatus).toBe(VerificationStatus.REJECTED);
      expect(found!.rejectionReason).toBe(
        'Business registration number could not be verified',
      );
    });
  });

  describe('cascade behaviour', () => {
    it('deletes the dealer_profiles row when the owning user is deleted (ON DELETE CASCADE)', async () => {
      const user = await createFixtureUser(ds, { role: 'DEALER' });
      await create(user.id);

      await deleteFixtureUser(ds, user.id);
      const idx = createdUserIds.indexOf(user.id);
      if (idx >= 0) createdUserIds.splice(idx, 1);

      const orphan = await repository.findByUserId(user.id);
      expect(orphan).toBeNull();
    });
  });
});
