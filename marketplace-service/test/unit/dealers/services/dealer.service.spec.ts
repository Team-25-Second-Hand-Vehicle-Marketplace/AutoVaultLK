import { NotFoundException, NotImplementedException } from '@nestjs/common';
import { DealerService } from '../../../../src/modules/dealers/services/dealer.service';
import type { DealerSummary } from '../../../../src/modules/dealers/repositories/dealer.repository';

describe('DealerService', () => {
  const dealerRepository = {
    findById: jest.fn(),
    findProfile: jest.fn(),
  };
  const service = new DealerService(dealerRepository as never);

  beforeEach(() => jest.clearAllMocks());

  const SUMMARY: DealerSummary = {
    id: 'dealer-1',
    businessName: 'Acme Motors',
    ownerName: 'Jane Doe',
    email: 'jane@acme.test',
    phone: '+94771234567',
    city: 'Colombo',
    verificationStatus: 'VERIFIED',
  };

  describe('getProfile', () => {
    it('returns the dealer summary when found', async () => {
      dealerRepository.findById.mockResolvedValue(SUMMARY);

      await expect(service.getProfile('dealer-1')).resolves.toEqual(SUMMARY);
      expect(dealerRepository.findById).toHaveBeenCalledWith('dealer-1');
    });

    it('404s when the dealer repository returns null', async () => {
      dealerRepository.findById.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getDealerById', () => {
    it('delegates to getProfile (same not-found behavior)', async () => {
      dealerRepository.findById.mockResolvedValue(SUMMARY);

      await expect(service.getDealerById('dealer-1')).resolves.toEqual(SUMMARY);
    });

    it('propagates the 404 from getProfile', async () => {
      dealerRepository.findById.mockResolvedValue(null);

      await expect(service.getDealerById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('always throws — dealer profile writes are owned by auth-user-service', () => {
      expect(() => service.updateProfile('dealer-1', {})).toThrow(NotImplementedException);
    });
  });
});
