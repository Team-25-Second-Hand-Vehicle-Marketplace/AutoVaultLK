import { DealerRepository } from '../../../../src/modules/dealers/repositories/dealer.repository';
import type { AuthUserView } from '../../../../src/infrastructure/database/entities/auth-user.view-entity';
import type { DealerProfileView } from '../../../../src/infrastructure/database/entities/dealer-profile.view-entity';

describe('DealerRepository', () => {
  const userRepo = { findOne: jest.fn() };
  const profileRepo = { findOne: jest.fn() };
  const repository = new DealerRepository(userRepo as never, profileRepo as never);

  beforeEach(() => jest.clearAllMocks());

  const USER: Partial<AuthUserView> = {
    id: 'dealer-1',
    name: 'Jane Doe',
    email: 'jane@acme.test',
    role: 'DEALER',
    isActive: true,
  };

  const PROFILE: Partial<DealerProfileView> = {
    userId: 'dealer-1',
    companyName: 'Acme Motors',
    contactNumber: '+94771234567',
    city: 'Colombo',
    verificationStatus: 'VERIFIED',
  };

  describe('findById', () => {
    it('only matches an active DEALER-role user, never a BUYER or ADMIN', async () => {
      userRepo.findOne.mockResolvedValue(USER);
      profileRepo.findOne.mockResolvedValue(PROFILE);

      await repository.findById('dealer-1');

      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'dealer-1', role: 'DEALER', isActive: true },
      });
    });

    it('returns null when no matching user exists', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(repository.findById('missing')).resolves.toBeNull();
      expect(profileRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns null when the user exists but has no dealer profile row', async () => {
      userRepo.findOne.mockResolvedValue(USER);
      profileRepo.findOne.mockResolvedValue(null);

      await expect(repository.findById('dealer-1')).resolves.toBeNull();
    });

    it('maps the user + profile join into a flat DealerSummary', async () => {
      userRepo.findOne.mockResolvedValue(USER);
      profileRepo.findOne.mockResolvedValue(PROFILE);

      await expect(repository.findById('dealer-1')).resolves.toEqual({
        id: 'dealer-1',
        businessName: 'Acme Motors',
        ownerName: 'Jane Doe',
        email: 'jane@acme.test',
        phone: '+94771234567',
        city: 'Colombo',
        verificationStatus: 'VERIFIED',
      });
    });
  });

  describe('findProfile', () => {
    it('is an alias for findById', async () => {
      userRepo.findOne.mockResolvedValue(USER);
      profileRepo.findOne.mockResolvedValue(PROFILE);

      const [byId, viaProfile] = await Promise.all([
        repository.findById('dealer-1'),
        repository.findProfile('dealer-1'),
      ]);

      expect(viaProfile).toEqual(byId);
    });
  });
});
