import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ListingService } from '../../../../src/modules/listings/services/listing.service';
import type { Vehicle } from '../../../../src/infrastructure/database/entities/vehicle.entity';
import type { AuthenticatedUser } from '../../../../src/modules/auth/types/authenticated-user.type';
import type { DealerSummary } from '../../../../src/modules/dealers/repositories/dealer.repository';

describe('ListingService', () => {
  const listingRepository = {
    create: jest.fn(),
    findAllLive: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
  };
  const dealerService = {
    getDealerById: jest.fn(),
  };
  const service = new ListingService(listingRepository as never, dealerService as never);

  beforeEach(() => jest.clearAllMocks());

  const DEALER: AuthenticatedUser = { id: 'dealer-1', email: 'd@test.com', role: 'DEALER' };
  const ADMIN: AuthenticatedUser = { id: 'admin-1', email: 'a@test.com', role: 'ADMIN' };
  const OTHER_DEALER: AuthenticatedUser = { id: 'dealer-2', email: 'd2@test.com', role: 'DEALER' };

  const DEALER_SUMMARY: DealerSummary = {
    id: 'dealer-1',
    businessName: 'Acme Motors',
    ownerName: 'Jane Doe',
    email: 'jane@acme.test',
    phone: null,
    city: 'Colombo',
    verificationStatus: 'VERIFIED',
  };

  function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
    return {
      id: 'v-1',
      dealerId: 'dealer-1',
      status: 'LIVE',
      make: 'Toyota',
      model: 'Aqua',
      ...overrides,
    } as Vehicle;
  }

  describe('createListing', () => {
    it('ignores a dealerId in the DTO and attributes the listing to the JWT actor (FR-13/FR-58)', async () => {
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);
      listingRepository.create.mockResolvedValue(vehicle());

      await service.createListing(
        { dealerId: 'someone-elses-id', make: 'Toyota' } as never,
        DEALER,
      );

      expect(listingRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ dealerId: DEALER.id }),
        'LIVE',
      );
    });

    it('defaults status to LIVE when the DTO omits it', async () => {
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);
      listingRepository.create.mockResolvedValue(vehicle());

      await service.createListing({ make: 'Toyota' } as never, DEALER);

      expect(listingRepository.create).toHaveBeenCalledWith(expect.anything(), 'LIVE');
    });

    it('honours an explicit status from the DTO', async () => {
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);
      listingRepository.create.mockResolvedValue(vehicle({ status: 'DRAFT' }));

      await service.createListing({ make: 'Toyota', status: 'DRAFT' } as never, DEALER);

      expect(listingRepository.create).toHaveBeenCalledWith(expect.anything(), 'DRAFT');
    });
  });

  describe('getListingById', () => {
    it('returns the listing with dealer info attached when LIVE', async () => {
      listingRepository.findById.mockResolvedValue(vehicle());
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);

      const result = await service.getListingById('v-1');

      expect(result.data).toMatchObject({
        id: 'v-1',
        dealer: { id: DEALER_SUMMARY.id, businessName: DEALER_SUMMARY.businessName },
      });
    });

    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.getListingById('missing')).rejects.toThrow(NotFoundException);
    });

    it('404s a non-LIVE listing the same as a missing one', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ status: 'DRAFT' }));

      await expect(service.getListingById('v-1')).rejects.toThrow(NotFoundException);
    });

    it('returns dealer: null (not an error) when the dealer lookup 404s', async () => {
      listingRepository.findById.mockResolvedValue(vehicle());
      dealerService.getDealerById.mockRejectedValue(new NotFoundException());

      const result = await service.getListingById('v-1');

      expect(result.data.dealer).toBeNull();
    });

    it('also returns dealer: null when the dealer lookup fails for another reason', async () => {
      listingRepository.findById.mockResolvedValue(vehicle());
      dealerService.getDealerById.mockRejectedValue(new Error('db down'));

      const result = await service.getListingById('v-1');

      expect(result.data.dealer).toBeNull();
    });
  });

  describe('getAllListings', () => {
    it('attaches dealer info to every live listing', async () => {
      listingRepository.findAllLive.mockResolvedValue([vehicle({ id: 'v-1' }), vehicle({ id: 'v-2' })]);
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);

      const result = await service.getAllListings();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].dealer).not.toBeNull();
    });
  });

  describe('updateListing', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.updateListing('missing', {}, DEALER)).rejects.toThrow(NotFoundException);
    });

    it('allows the owning dealer to update their own listing', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));
      listingRepository.update.mockResolvedValue(vehicle());

      await expect(service.updateListing('v-1', { make: 'Honda' } as never, DEALER)).resolves.toBeDefined();
    });

    it('forbids a different dealer from updating someone else\'s listing', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));

      await expect(
        service.updateListing('v-1', { make: 'Honda' } as never, OTHER_DEALER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN to update any listing regardless of owner', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));
      listingRepository.update.mockResolvedValue(vehicle());

      await expect(service.updateListing('v-1', { make: 'Honda' } as never, ADMIN)).resolves.toBeDefined();
    });

    it('strips dealerId from the update payload even if the caller supplies one', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));
      listingRepository.update.mockResolvedValue(vehicle());

      await service.updateListing(
        'v-1',
        { dealerId: 'someone-else', make: 'Honda' } as never,
        DEALER,
      );

      const [, payload] = listingRepository.update.mock.calls[0];
      expect(payload).not.toHaveProperty('dealerId');
    });
  });

  describe('deactivateListing', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.deactivateListing('missing', DEALER)).rejects.toThrow(NotFoundException);
    });

    it('forbids a non-owning dealer from deactivating the listing', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));

      await expect(service.deactivateListing('v-1', OTHER_DEALER)).rejects.toThrow(ForbiddenException);
    });

    it('allows the owning dealer to deactivate their own listing', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));
      listingRepository.deactivate.mockResolvedValue(vehicle({ status: 'ARCHIVED' }));

      const result = await service.deactivateListing('v-1', DEALER);

      expect(result.data.status).toBe('ARCHIVED');
    });

    it('allows ADMIN to deactivate any listing', async () => {
      listingRepository.findById.mockResolvedValue(vehicle({ dealerId: DEALER.id }));
      listingRepository.deactivate.mockResolvedValue(vehicle({ status: 'ARCHIVED' }));

      await expect(service.deactivateListing('v-1', ADMIN)).resolves.toBeDefined();
    });
  });
});
