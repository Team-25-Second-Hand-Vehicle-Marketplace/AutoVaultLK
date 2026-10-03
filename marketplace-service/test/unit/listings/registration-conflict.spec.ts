import { ConflictException } from '@nestjs/common';
import {
  guardRegistration,
  isActiveRegistrationConflict,
  REGISTRATION_CONFLICT_MESSAGE,
} from '../../../src/modules/listings/registration-conflict';
import { ListingService } from '../../../src/modules/listings/services/listing.service';
import { ACTIVE_REGISTRATION_INDEX } from '../../../src/modules/listings/listing-expiry';
import type { AuthenticatedUser } from '../../../src/modules/auth/types/authenticated-user.type';

function uniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    driverError: { code: '23505', constraint },
  });
}

describe('registration conflict', () => {
  it('recognises a violation of the active-registration index', () => {
    expect(isActiveRegistrationConflict(uniqueViolation(ACTIVE_REGISTRATION_INDEX))).toBe(true);
  });

  it('ignores violations of other constraints', () => {
    expect(isActiveRegistrationConflict(uniqueViolation('idx_vehicles_job_registration'))).toBe(false);
    expect(isActiveRegistrationConflict(new Error('boom'))).toBe(false);
  });

  it('turns the violation into a 409 with a clear message', async () => {
    await expect(
      guardRegistration(() => Promise.reject(uniqueViolation(ACTIVE_REGISTRATION_INDEX))),
    ).rejects.toThrow(new ConflictException(REGISTRATION_CONFLICT_MESSAGE));
  });

  it('lets other errors through unchanged', async () => {
    const other = new Error('connection lost');
    await expect(guardRegistration(() => Promise.reject(other))).rejects.toBe(other);
  });

  it('a create that loses the registration race returns a 409 from the service', async () => {
    const listingRepository = {
      findRecentDuplicate: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(uniqueViolation(ACTIVE_REGISTRATION_INDEX)),
    };
    const dealerService = {
      getDealerById: jest.fn().mockResolvedValue({ verificationStatus: 'VERIFIED' }),
    };
    const service = new ListingService(
      listingRepository as never,
      dealerService as never,
      {} as never,
      {} as never,
    );
    const dealer: AuthenticatedUser = { id: 'dealer-1', email: 'd@test.com', role: 'DEALER' };

    await expect(
      service.createListing({ registrationNumber: 'AB-1234' } as never, dealer),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
