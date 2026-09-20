import { FavouritesController } from '../../../../src/modules/favourites/controllers/favourites.controller';

describe('FavouritesController', () => {
  const favouritesService = {
    addFavourite: jest.fn(),
    getMyFavourites: jest.fn(),
    removeFavourite: jest.fn(),
  };
  const controller = new FavouritesController(favouritesService as never);

  /** What JwtAuthGuard puts on the request. */
  const request = { user: { id: 'buyer-1', email: 'b@test.com', role: 'BUYER' } };

  beforeEach(() => jest.clearAllMocks());

  it('adds using the buyer id from the token, not from the URL', async () => {
    // The authorization boundary: a buyer id taken from anywhere but the
    // verified token would let one buyer write to another's list.
    favouritesService.addFavourite.mockResolvedValue({ id: 'f-1' });

    await controller.addFavourite('v-1', request as never);

    expect(favouritesService.addFavourite).toHaveBeenCalledWith('buyer-1', 'v-1');
  });

  it('lists only the caller\'s favourites', async () => {
    favouritesService.getMyFavourites.mockResolvedValue([]);

    await controller.getMyFavourites(request as never);

    expect(favouritesService.getMyFavourites).toHaveBeenCalledWith('buyer-1');
  });

  it('removes using the buyer id from the token', async () => {
    favouritesService.removeFavourite.mockResolvedValue({ message: 'ok' });

    await controller.removeFavourite('v-1', request as never);

    expect(favouritesService.removeFavourite).toHaveBeenCalledWith('buyer-1', 'v-1');
  });

  it('returns what the service returns, unwrapped', async () => {
    favouritesService.getMyFavourites.mockResolvedValue([{ id: 'f-1' }]);

    await expect(controller.getMyFavourites(request as never)).resolves.toEqual([
      { id: 'f-1' },
    ]);
  });
});
