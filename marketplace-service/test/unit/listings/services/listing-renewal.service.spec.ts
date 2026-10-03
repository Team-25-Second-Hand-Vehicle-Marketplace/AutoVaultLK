import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ListingService } from '../../../../src/modules/listings/services/listing.service';
import type { Vehicle } from '../../../../src/infrastructure/database/entities/vehicle.entity';
import type { AuthenticatedUser } from '../../../../src/modules/auth/types/authenticated-user.type';

describe('ListingService - renewal', () => {
  const listingRepository = {
    findById: jest.fn(),
    setExpiry: jest.fn(),
    relist: jest.fn(),
    renewMany: jest.fn(),
  };
  const service = new ListingService(
    listingRepository as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const DEALER: AuthenticatedUser = { id: 'dealer-1', email: 'd@test.com', role: 'DEALER' };
  const OTHER: AuthenticatedUser = { id: 'dealer-2', email: 'o@test.com', role: 'DEALER' };

  function listing(overrides: Partial<Vehicle>): Vehicle {
    return { id: 'v-1', dealerId: 'dealer-1', status: 'LIVE', expiresAt: null, ...overrides } as Vehicle;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extends a LIVE listing from its expiry day', async () => {
    const expiry = new Date(Date.now() + 2 * 86_400_000);
    listingRepository.findById.mockResolvedValue(listing({ expiresAt: expiry }));
    listingRepository.setExpiry.mockImplementation(async (_id, when) => listing({ expiresAt: when }));

    const result = await service.renewListing('v-1', DEALER);

    expect(listingRepository.setExpiry).toHaveBeenCalledTimes(1);
    const newExpiry = listingRepository.setExpiry.mock.calls[0][1] as Date;
    expect(newExpiry.getTime()).toBe(expiry.getTime() + 90 * 86_400_000);
    expect(result.message).toBe('Vehicle listing renewed');
  });

  it('relists an ARCHIVED listing with a fresh term', async () => {
    listingRepository.findById.mockResolvedValue(listing({ status: 'ARCHIVED' }));
    listingRepository.relist.mockResolvedValue(listing({ status: 'LIVE' }));

    const result = await service.renewListing('v-1', DEALER);

    expect(listingRepository.relist).toHaveBeenCalledWith('v-1', expect.any(Date));
    expect(result.message).toBe('Vehicle listing relisted');
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const)(
    'refuses to renew a %s listing',
    async (status) => {
      listingRepository.findById.mockResolvedValue(listing({ status }));

      await expect(service.renewListing('v-1', DEALER)).rejects.toThrow(ConflictException);
      expect(listingRepository.setExpiry).not.toHaveBeenCalled();
      expect(listingRepository.relist).not.toHaveBeenCalled();
    },
  );

  it('does not let another dealer renew a listing', async () => {
    listingRepository.findById.mockResolvedValue(listing({ status: 'LIVE' }));

    await expect(service.renewListing('v-1', OTHER)).rejects.toThrow(ForbiddenException);
    expect(listingRepository.setExpiry).not.toHaveBeenCalled();
  });

  it('reports a missing listing as not found', async () => {
    listingRepository.findById.mockResolvedValue(null);

    await expect(service.renewListing('missing', DEALER)).rejects.toThrow(NotFoundException);
  });

  it('renews a batch and reports the count', async () => {
    listingRepository.renewMany.mockResolvedValue(3);

    const result = await service.renewListings(DEALER, { expiringWithinDays: 5 });

    expect(listingRepository.renewMany).toHaveBeenCalledWith('dealer-1', undefined, 5);
    expect(result.data).toEqual({ renewed: 3 });
    expect(result.message).toBe('3 listings renewed for another 90 days');
  });
});
