import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ListingService } from '../../../../src/modules/listings/services/listing.service';
import type { Vehicle } from '../../../../src/infrastructure/database/entities/vehicle.entity';
import type { AuthenticatedUser } from '../../../../src/modules/auth/types/authenticated-user.type';
import type { DealerSummary } from '../../../../src/modules/dealers/repositories/dealer.repository';

describe('ListingService', () => {
  const listingRepository = {
    create: jest.fn(),
    findRecentDuplicate: jest.fn(),
    findAllLive: jest.fn(),
    findByDealer: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    approve: jest.fn(),
    approveAllPending: jest.fn(),
    approveSelected: jest.fn(),
    unarchive: jest.fn(),
    remove: jest.fn(),
  };
  const dealerService = {
    getDealerById: jest.fn(),
  };
  const imageUploadService = {
    replaceImages: jest.fn(),
    deleteImage: jest.fn(),
  };
  const imageUrlResolver = {
    resolve: jest.fn().mockResolvedValue(null),
    resolveAll: jest.fn().mockResolvedValue([]),
  };
  const service = new ListingService(
    listingRepository as never,
    dealerService as never,
    imageUploadService as never,
    imageUrlResolver as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    // mockClear keeps implementations, so reset the duplicate lookup explicitly.
    listingRepository.findRecentDuplicate.mockResolvedValue(null);
  });

  const DEALER: AuthenticatedUser = {
    id: 'dealer-1',
    email: 'd@test.com',
    role: 'DEALER',
  };
  const ADMIN: AuthenticatedUser = {
    id: 'admin-1',
    email: 'a@test.com',
    role: 'ADMIN',
  };
  const OTHER_DEALER: AuthenticatedUser = {
    id: 'dealer-2',
    email: 'd2@test.com',
    role: 'DEALER',
  };

  const DEALER_SUMMARY: DealerSummary = {
    id: 'dealer-1',
    businessName: 'Acme Motors',
    ownerName: 'Jane Doe',
    email: 'jane@acme.test',
    phone: null,
    city: 'Colombo',
    verificationStatus: 'VERIFIED',
    dealerType: 'individual',
  };

  const BUSINESS_DEALER_SUMMARY: DealerSummary = {
    ...DEALER_SUMMARY,
    dealerType: 'business',
  };

  const UNVERIFIED_DEALER_SUMMARY: DealerSummary = {
    ...DEALER_SUMMARY,
    verificationStatus: 'PENDING',
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
    it('returns the existing listing instead of creating a twin on an identical resubmit', async () => {
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);
      const existing = vehicle();
      listingRepository.findRecentDuplicate.mockResolvedValue(existing);

      const result = await service.createListing({ make: 'Toyota' } as never, DEALER);

      expect(listingRepository.create).not.toHaveBeenCalled();
      expect(result.data).toBe(existing);
      expect(listingRepository.findRecentDuplicate).toHaveBeenCalledWith(
        expect.objectContaining({ dealerId: DEALER.id }),
        expect.any(Number),
      );
    });

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

      expect(listingRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        'LIVE',
      );
    });

    it('honours an explicit status from the DTO', async () => {
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);
      listingRepository.create.mockResolvedValue(vehicle({ status: 'DRAFT' }));

      await service.createListing(
        { make: 'Toyota', status: 'DRAFT' } as never,
        DEALER,
      );

      expect(listingRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        'DRAFT',
      );
    });

    it('allows a verified business dealer to create a manual listing (in addition to bulk upload)', async () => {
      dealerService.getDealerById.mockResolvedValue(BUSINESS_DEALER_SUMMARY);
      listingRepository.create.mockResolvedValue(vehicle());

      await service.createListing({ make: 'Toyota' } as never, DEALER);

      expect(listingRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        'LIVE',
      );
    });

    // A dealer can now log in while PENDING or REJECTED (approval no longer
    // gates login - see auth-user-service). This is the check that stands
    // between that and a real LIVE listing. Applies regardless of dealer
    // type, since manual listing is no longer restricted by dealerType.
    it('forbids a dealer of any type who is not yet VERIFIED', async () => {
      dealerService.getDealerById.mockResolvedValue(UNVERIFIED_DEALER_SUMMARY);

      await expect(
        service.createListing({ make: 'Toyota' } as never, DEALER),
      ).rejects.toThrow(ForbiddenException);
      expect(listingRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getListingById', () => {
    it('returns the listing with dealer info attached when LIVE', async () => {
      listingRepository.findById.mockResolvedValue(vehicle());
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);

      const result = await service.getListingById('v-1');

      expect(result.data).toMatchObject({
        id: 'v-1',
        dealer: {
          id: DEALER_SUMMARY.id,
          businessName: DEALER_SUMMARY.businessName,
        },
      });
    });

    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.getListingById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s a non-LIVE listing the same as a missing one', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ status: 'DRAFT' }),
      );

      await expect(service.getListingById('v-1')).rejects.toThrow(
        NotFoundException,
      );
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
      listingRepository.findAllLive.mockResolvedValue([
        vehicle({ id: 'v-1' }),
        vehicle({ id: 'v-2' }),
      ]);
      dealerService.getDealerById.mockResolvedValue(DEALER_SUMMARY);

      const result = await service.getAllListings();

      expect(result.data).toHaveLength(2);
      expect(result.data[0].dealer).not.toBeNull();
    });
  });

  describe('getMyListings', () => {
    it("returns every status for the caller's own listings, unlike the public LIVE-only feed", async () => {
      listingRepository.findByDealer.mockResolvedValue([
        vehicle({ id: 'v-1', status: 'DRAFT' }),
        vehicle({ id: 'v-2', status: 'PENDING_REVIEW' }),
        vehicle({ id: 'v-3', status: 'LIVE' }),
      ]);

      const result = await service.getMyListings(DEALER);

      expect(listingRepository.findByDealer).toHaveBeenCalledWith(
        DEALER.id,
        undefined,
      );
      expect(result.data).toHaveLength(3);
      expect(result.data.map((v) => v.status)).toEqual([
        'DRAFT',
        'PENDING_REVIEW',
        'LIVE',
      ]);
    });

    it('passes a confidence_asc sort through to the repository (FR-42.1)', async () => {
      listingRepository.findByDealer.mockResolvedValue([]);

      await service.getMyListings(DEALER, 'confidence_asc');

      expect(listingRepository.findByDealer).toHaveBeenCalledWith(
        DEALER.id,
        'confidence_asc',
      );
    });

    it('does not attach dealer info (the caller already knows who they are)', async () => {
      listingRepository.findByDealer.mockResolvedValue([vehicle()]);

      const result = await service.getMyListings(DEALER);

      expect(result.data[0]).not.toHaveProperty('dealer');
    });
  });

  describe('updateListing', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateListing('missing', {}, DEALER),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows the owning dealer to update their own listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
      listingRepository.update.mockResolvedValue(vehicle());

      await expect(
        service.updateListing('v-1', { make: 'Honda' } as never, DEALER),
      ).resolves.toBeDefined();
    });

    it("forbids a different dealer from updating someone else's listing", async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.updateListing('v-1', { make: 'Honda' } as never, OTHER_DEALER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN to update any listing regardless of owner', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
      listingRepository.update.mockResolvedValue(vehicle());

      await expect(
        service.updateListing('v-1', { make: 'Honda' } as never, ADMIN),
      ).resolves.toBeDefined();
    });

    it('strips dealerId from the update payload even if the caller supplies one', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
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

      await expect(
        service.deactivateListing('missing', DEALER),
      ).rejects.toThrow(NotFoundException);
    });

    it('forbids a non-owning dealer from deactivating the listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.deactivateListing('v-1', OTHER_DEALER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the owning dealer to deactivate their own listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
      listingRepository.deactivate.mockResolvedValue(
        vehicle({ status: 'ARCHIVED' }),
      );

      const result = await service.deactivateListing('v-1', DEALER);

      expect(result.data.status).toBe('ARCHIVED');
    });

    it('allows ADMIN to deactivate any listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
      listingRepository.deactivate.mockResolvedValue(
        vehicle({ status: 'ARCHIVED' }),
      );

      await expect(
        service.deactivateListing('v-1', ADMIN),
      ).resolves.toBeDefined();
    });
  });

  describe('approveAllPending', () => {
    it("approves only the calling dealer's own pending listings", async () => {
      listingRepository.approveAllPending.mockResolvedValue(99);

      const result = await service.approveAllPending(DEALER);

      // Scoped by the JWT's id, never by anything the client sent.
      expect(listingRepository.approveAllPending).toHaveBeenCalledWith('dealer-1');
      expect(result.data).toEqual({ approved: 99 });
      expect(result.message).toBe('99 listings approved and published');
    });

    it('uses the singular for one listing', async () => {
      listingRepository.approveAllPending.mockResolvedValue(1);

      const result = await service.approveAllPending(DEALER);

      expect(result.message).toBe('1 listing approved and published');
    });

    it('answers approved: 0 rather than erroring when nothing is pending', async () => {
      listingRepository.approveAllPending.mockResolvedValue(0);

      const result = await service.approveAllPending(DEALER);

      expect(result.data).toEqual({ approved: 0 });
    });
  });

  describe('approveSelected', () => {
    const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

    it("approves the selected ids for the calling dealer only", async () => {
      listingRepository.approveSelected.mockResolvedValue(2);

      const result = await service.approveSelected(DEALER, IDS);

      // Scoped by the JWT's id, never by anything the client sent.
      expect(listingRepository.approveSelected).toHaveBeenCalledWith('dealer-1', IDS);
      expect(result.data).toEqual({ approved: 2, skipped: 0 });
      expect(result.message).toBe('2 listings approved and published');
    });

    it('reports the ones that were skipped because they were no longer pending', async () => {
      listingRepository.approveSelected.mockResolvedValue(1);

      const result = await service.approveSelected(DEALER, IDS);

      expect(result.data).toEqual({ approved: 1, skipped: 1 });
      expect(result.message).toBe('1 listing approved and published');
    });

    it('answers approved: 0 rather than erroring when none were pending', async () => {
      listingRepository.approveSelected.mockResolvedValue(0);

      const result = await service.approveSelected(DEALER, IDS);

      expect(result.data).toEqual({ approved: 0, skipped: 2 });
      expect(result.message).toBe('None of the selected listings were awaiting approval');
    });
  });

  describe('approveListing (FR-42)', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.approveListing('missing', DEALER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('forbids a non-owning dealer from approving the listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'PENDING_REVIEW' }),
      );

      await expect(service.approveListing('v-1', OTHER_DEALER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows the owning dealer to approve their own PENDING_REVIEW listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'PENDING_REVIEW' }),
      );
      listingRepository.approve.mockResolvedValue(vehicle({ status: 'LIVE' }));

      const result = await service.approveListing('v-1', DEALER);

      expect(result.data.status).toBe('LIVE');
      expect(listingRepository.approve).toHaveBeenCalledWith('v-1');
    });

    it("allows ADMIN to approve any dealer's PENDING_REVIEW listing", async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'PENDING_REVIEW' }),
      );
      listingRepository.approve.mockResolvedValue(vehicle({ status: 'LIVE' }));

      await expect(service.approveListing('v-1', ADMIN)).resolves.toBeDefined();
    });

    // A listing that is not PENDING_REVIEW is a 409, not a 404: the id is
    // real and the dealer may own it, but there is nothing to approve.
    it('409s a listing that is already LIVE', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'LIVE' }),
      );

      await expect(service.approveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
      expect(listingRepository.approve).not.toHaveBeenCalled();
    });

    it('409s a manually-created DRAFT listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'DRAFT' }),
      );

      await expect(service.approveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('409s a REJECTED listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'REJECTED' }),
      );

      await expect(service.approveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
    });

    // The status check happened on a read; a race with another
    // approve/deactivate between that read and the write below is the only
    // way the repository call itself returns null despite the check passing.
    it('409s when the repository write loses a race', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'PENDING_REVIEW' }),
      );
      listingRepository.approve.mockResolvedValue(null);

      await expect(service.approveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('unarchiveListing', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.unarchiveListing('missing', DEALER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('forbids a non-owning dealer from unarchiving the listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'ARCHIVED' }),
      );

      await expect(service.unarchiveListing('v-1', OTHER_DEALER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows the owning dealer to unarchive their own listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'ARCHIVED' }),
      );
      listingRepository.unarchive.mockResolvedValue(vehicle({ status: 'LIVE' }));

      const result = await service.unarchiveListing('v-1', DEALER);

      expect(result.data.status).toBe('LIVE');
      expect(listingRepository.unarchive).toHaveBeenCalledWith('v-1');
    });

    it("allows ADMIN to unarchive any dealer's listing", async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'ARCHIVED' }),
      );
      listingRepository.unarchive.mockResolvedValue(vehicle({ status: 'LIVE' }));

      await expect(service.unarchiveListing('v-1', ADMIN)).resolves.toBeDefined();
    });

    // A listing that is not ARCHIVED is a 409, not a 404: the id is real and
    // the dealer may own it, but there is nothing to unarchive.
    it('409s a listing that is LIVE', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'LIVE' }),
      );

      await expect(service.unarchiveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
      expect(listingRepository.unarchive).not.toHaveBeenCalled();
    });

    it('409s a DRAFT listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'DRAFT' }),
      );

      await expect(service.unarchiveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
    });

    // The status check happened on a read; a race with another
    // archive/unarchive between that read and the write below is the only way
    // the repository call itself returns null despite the check passing.
    it('409s when the repository write loses a race', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'ARCHIVED' }),
      );
      listingRepository.unarchive.mockResolvedValue(null);

      await expect(service.unarchiveListing('v-1', DEALER)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('deleteListing', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(service.deleteListing('missing', DEALER)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('forbids a non-owning dealer from deleting the listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'DRAFT' }),
      );

      await expect(service.deleteListing('v-1', OTHER_DEALER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it.each(['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const)(
      'allows the owning dealer to permanently delete a %s listing',
      async (status) => {
        listingRepository.findById.mockResolvedValue(
          vehicle({ dealerId: DEALER.id, status }),
        );
        listingRepository.remove.mockResolvedValue(true);

        await expect(service.deleteListing('v-1', DEALER)).resolves.toMatchObject({
          message: expect.stringContaining('deleted'),
        });
        expect(listingRepository.remove).toHaveBeenCalledWith('v-1');
      },
    );

    // LIVE, SOLD and ARCHIVED listings may already be referenced by a
    // favourite or a recommendation; only Archive is offered for those.
    it.each(['LIVE', 'SOLD', 'ARCHIVED'] as const)(
      '409s a %s listing rather than deleting it',
      async (status) => {
        listingRepository.findById.mockResolvedValue(
          vehicle({ dealerId: DEALER.id, status }),
        );

        await expect(service.deleteListing('v-1', DEALER)).rejects.toThrow(
          ConflictException,
        );
        expect(listingRepository.remove).not.toHaveBeenCalled();
      },
    );

    it('allows ADMIN to delete any dealer\'s DRAFT/PENDING_REVIEW/REJECTED listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'PENDING_REVIEW' }),
      );
      listingRepository.remove.mockResolvedValue(true);

      await expect(service.deleteListing('v-1', ADMIN)).resolves.toBeDefined();
    });

    // The status check happened on a read; a race with another delete
    // between that read and the write below is the only way the repository
    // call itself returns false despite the check passing.
    it('404s when the repository delete loses a race', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id, status: 'DRAFT' }),
      );
      listingRepository.remove.mockResolvedValue(false);

      await expect(service.deleteListing('v-1', DEALER)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('uploadImages (FR-58)', () => {
    const FILES = [
      {
        originalname: 'a.jpg',
        mimetype: 'image/jpeg',
        size: 1024,
        buffer: Buffer.from('x'),
      },
    ];

    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(
        service.uploadImages('missing', DEALER, FILES),
      ).rejects.toThrow(NotFoundException);
      expect(imageUploadService.replaceImages).not.toHaveBeenCalled();
    });

    it('forbids a non-owning dealer from uploading', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.uploadImages('v-1', OTHER_DEALER, FILES),
      ).rejects.toThrow(ForbiddenException);
      expect(imageUploadService.replaceImages).not.toHaveBeenCalled();
    });

    it('allows the owning dealer to upload images to their own listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
      imageUploadService.replaceImages.mockResolvedValue([{ id: 'img-1' }]);

      const result = await service.uploadImages('v-1', DEALER, FILES);

      expect(imageUploadService.replaceImages).toHaveBeenCalledWith(
        'v-1',
        FILES,
      );
      expect(result.data).toEqual([{ id: 'img-1' }]);
    });

    it('allows ADMIN to upload images to any listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );
      imageUploadService.replaceImages.mockResolvedValue([]);

      await expect(
        service.uploadImages('v-1', ADMIN, FILES),
      ).resolves.toBeDefined();
    });

    // Ownership must be checked before the (possibly expensive, possibly
    // billed) upload work starts - a non-owner's request should never reach
    // S3 or the local filesystem.
    it('checks ownership before calling the upload service', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.uploadImages('v-1', OTHER_DEALER, FILES),
      ).rejects.toThrow();

      expect(imageUploadService.replaceImages).not.toHaveBeenCalled();
    });
  });

  describe('deleteImage (FR-58)', () => {
    it('404s when the listing does not exist', async () => {
      listingRepository.findById.mockResolvedValue(null);

      await expect(
        service.deleteImage('missing', 'img-1', DEALER),
      ).rejects.toThrow(NotFoundException);
      expect(imageUploadService.deleteImage).not.toHaveBeenCalled();
    });

    it('forbids a non-owning dealer from deleting a photo', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.deleteImage('v-1', 'img-1', OTHER_DEALER),
      ).rejects.toThrow(ForbiddenException);
      expect(imageUploadService.deleteImage).not.toHaveBeenCalled();
    });

    it('allows the owning dealer to delete a photo from their own listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await service.deleteImage('v-1', 'img-1', DEALER);

      expect(imageUploadService.deleteImage).toHaveBeenCalledWith(
        'v-1',
        'img-1',
      );
    });

    it('allows ADMIN to delete a photo from any listing', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.deleteImage('v-1', 'img-1', ADMIN),
      ).resolves.toBeDefined();
    });

    it('checks ownership before calling the delete', async () => {
      listingRepository.findById.mockResolvedValue(
        vehicle({ dealerId: DEALER.id }),
      );

      await expect(
        service.deleteImage('v-1', 'img-1', OTHER_DEALER),
      ).rejects.toThrow();

      expect(imageUploadService.deleteImage).not.toHaveBeenCalled();
    });
  });
});
