import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DealerProfilesService } from '../../src/modules/dealers/services/dealer-profiles.service';
import {
  DealerProfile,
  DealerType,
  VerificationStatus,
} from '../../src/infrastructure/database/entities/dealer-profile.entity';

describe('DealerProfilesService', () => {
  const dealerProfilesRepository = {
    findAll: jest.fn(),
    findByUserId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const usersRepository = {
    findById: jest.fn(),
  };
  // A single mock `manager` reused across transaction calls, so a test can
  // assert exactly which entities the transaction touched.
  const manager = {
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };

  const service = new DealerProfilesService(
    dealerProfilesRepository as never,
    usersRepository as never,
    dataSource as never,
  );

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
      dealerType: DealerType.BUSINESS,
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

  describe('approve/reject - isActive is never touched', () => {
    // A dealer's ability to log in is decided once, on email verification,
    // the same as a buyer's; approve/reject only ever change DealerProfile
    // fields. This pins that regression directly: it used to also flip
    // User.isActive, which is what made a rejected dealer unable to log back
    // in and retry.
    const PENDING_PROFILE = {
      userId: 'dealer-1',
      verificationStatus: VerificationStatus.PENDING,
    };

    beforeEach(() => {
      dealerProfilesRepository.findByUserId.mockResolvedValue(PENDING_PROFILE);
      usersRepository.findById.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
      manager.update.mockResolvedValue({ affected: 1 });
      manager.findOne.mockResolvedValue({ ...PENDING_PROFILE, verificationStatus: 'VERIFIED' });
    });

    it('approve only updates DealerProfile, never User', async () => {
      await service.approveDealer('dealer-1', 'admin-1');

      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        DealerProfile,
        expect.anything(),
        expect.anything(),
      );
    });

    it('reject only updates DealerProfile, never User', async () => {
      await service.rejectDealer('dealer-1', 'admin-1', 'Blurry document');

      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(
        DealerProfile,
        expect.anything(),
        expect.objectContaining({
          verificationStatus: VerificationStatus.REJECTED,
          rejectionReason: 'Blurry document',
        }),
      );
    });

    it('refuses to decide on a profile that already has a decision', async () => {
      dealerProfilesRepository.findByUserId.mockResolvedValue({
        ...PENDING_PROFILE,
        verificationStatus: VerificationStatus.VERIFIED,
      });

      await expect(service.approveDealer('dealer-1', 'admin-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('resubmit', () => {
    const REJECTED_INDIVIDUAL = {
      userId: 'dealer-1',
      dealerType: DealerType.INDIVIDUAL,
      verificationStatus: VerificationStatus.REJECTED,
      rejectionReason: 'NIC was unreadable',
    };

    it('refuses when the profile is not REJECTED', async () => {
      dealerProfilesRepository.findByUserId.mockResolvedValue({
        ...REJECTED_INDIVIDUAL,
        verificationStatus: VerificationStatus.PENDING,
      });

      await expect(
        service.resubmit('dealer-1', { verificationDocuments: { nic: '991234567V' } }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(dealerProfilesRepository.update).not.toHaveBeenCalled();
    });

    it("refuses a document that doesn't match the dealer's type", async () => {
      dealerProfilesRepository.findByUserId.mockResolvedValue(REJECTED_INDIVIDUAL);

      // A business certificate key, not the NIC an individual dealer needs.
      await expect(
        service.resubmit('dealer-1', {
          verificationDocuments: { businessRegistrationCertificate: 'key' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dealerProfilesRepository.update).not.toHaveBeenCalled();
    });

    it('resets status to PENDING and clears the rejection reason on success', async () => {
      dealerProfilesRepository.findByUserId.mockResolvedValue(REJECTED_INDIVIDUAL);
      dealerProfilesRepository.update.mockResolvedValue({});

      await service.resubmit('dealer-1', {
        city: 'Kandy',
        verificationDocuments: { nic: '991234567V' },
      });

      expect(dealerProfilesRepository.update).toHaveBeenCalledWith('dealer-1', {
        city: 'Kandy',
        verificationDocuments: { nic: '991234567V' },
        verificationStatus: VerificationStatus.PENDING,
        rejectionReason: null,
      });
    });
  });
});
