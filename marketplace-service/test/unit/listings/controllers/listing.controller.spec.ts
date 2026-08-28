import { ListingController } from '../../../../src/modules/listings/controllers/listing.controller';
import type { AuthenticatedUser } from '../../../../src/modules/auth/types/authenticated-user.type';

describe('ListingController', () => {
  const listingService = {
    createListing: jest.fn(),
    getAllListings: jest.fn(),
    getListingById: jest.fn(),
    updateListing: jest.fn(),
    deactivateListing: jest.fn(),
  };
  const controller = new ListingController(listingService as never);
  const actor: AuthenticatedUser = { id: 'dealer-1', email: 'd@test.com', role: 'DEALER' };

  beforeEach(() => jest.clearAllMocks());

  it('POST / passes the DTO and the JWT actor to createListing (never a body-supplied dealer)', () => {
    const dto = { make: 'Toyota' };
    listingService.createListing.mockReturnValue('created');

    expect(controller.createListing(dto as never, actor)).toBe('created');
    expect(listingService.createListing).toHaveBeenCalledWith(dto, actor);
  });

  it('GET / delegates to getAllListings with no arguments', () => {
    listingService.getAllListings.mockReturnValue('all');

    expect(controller.getAllListings()).toBe('all');
    expect(listingService.getAllListings).toHaveBeenCalledWith();
  });

  it('GET :id delegates to getListingById', () => {
    listingService.getListingById.mockReturnValue('one');

    expect(controller.getListingById('v-1')).toBe('one');
    expect(listingService.getListingById).toHaveBeenCalledWith('v-1');
  });

  it('PATCH :id passes id, dto, and actor to updateListing', () => {
    const dto = { make: 'Honda' };
    listingService.updateListing.mockReturnValue('updated');

    expect(controller.updateListing('v-1', dto as never, actor)).toBe('updated');
    expect(listingService.updateListing).toHaveBeenCalledWith('v-1', dto, actor);
  });

  it('PATCH :id/deactivate passes id and actor to deactivateListing', () => {
    listingService.deactivateListing.mockReturnValue('deactivated');

    expect(controller.deactivateListing('v-1', actor)).toBe('deactivated');
    expect(listingService.deactivateListing).toHaveBeenCalledWith('v-1', actor);
  });
});
