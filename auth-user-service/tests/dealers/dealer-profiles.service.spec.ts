import { NotFoundException } from '@nestjs/common';
import { DealerProfilesService } from '../../src/modules/dealers/services/dealer-profiles.service';

describe('DealerProfilesService', () => {
  const dealerProfilesRepository = {
    findAll: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const service = new DealerProfilesService(dealerProfilesRepository as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns a dealer profile by user id', async () => {
    const profile = { userId: 'dealer-id', companyName: 'Test Motors' };
    dealerProfilesRepository.findByUserId.mockResolvedValue(profile);

    await expect(service.findByUserId('dealer-id')).resolves.toBe(profile);
  });

  it('throws when a dealer profile does not exist', async () => {
    dealerProfilesRepository.findByUserId.mockResolvedValue(null);

    await expect(service.findByUserId('missing-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('delegates profile creation to the repository', async () => {
    const data = {
      userId: 'dealer-id',
      dealerType: 'business',
      businessRegistrationNumber: 'BR-001',
      businessAddress: '1 Main Street',
      city: 'Colombo',
      verificationDocuments: { registration: 'key' },
      companyName: 'Test Motors',
      contactNumber: '+94110000000',
    };
    dealerProfilesRepository.create.mockResolvedValue(data);

    await service.create(data);

    expect(dealerProfilesRepository.create).toHaveBeenCalledWith(data);
  });
});
