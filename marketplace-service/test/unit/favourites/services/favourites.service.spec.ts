import { ConflictException, NotFoundException } from '@nestjs/common';
import { FavouritesService } from '../../../../src/modules/favourites/services/favourites.service';

describe('FavouritesService', () => {
  const favouritesRepository = {
    findFavourite: jest.fn(),
    createFavourite: jest.fn(),
    findByBuyer: jest.fn(),
    findPrimaryImagePaths: jest.fn(),
    deleteFavourite: jest.fn(),
  };
  const imageUrlResolver = { resolve: jest.fn() };
  const service = new FavouritesService(
    favouritesRepository as never,
    imageUrlResolver as never,
  );

  beforeEach(() => jest.clearAllMocks());

  describe('addFavourite', () => {
    it('creates the row when the vehicle is not already saved', async () => {
      favouritesRepository.findFavourite.mockResolvedValue(null);
      favouritesRepository.createFavourite.mockResolvedValue({ id: 'f-1' });

      await expect(service.addFavourite('buyer-1', 'v-1')).resolves.toEqual({ id: 'f-1' });
      expect(favouritesRepository.createFavourite).toHaveBeenCalledWith('buyer-1', 'v-1');
    });

    it('409s on a duplicate rather than creating a second row', async () => {
      favouritesRepository.findFavourite.mockResolvedValue({ id: 'f-1' });

      await expect(service.addFavourite('buyer-1', 'v-1')).rejects.toThrow(ConflictException);
    });

    it('does not write when it conflicts', async () => {
      // The check and the write are two statements, so a refactor could leave
      // the write reachable. There is no unique constraint behind this.
      favouritesRepository.findFavourite.mockResolvedValue({ id: 'f-1' });

      await expect(service.addFavourite('buyer-1', 'v-1')).rejects.toThrow();

      expect(favouritesRepository.createFavourite).not.toHaveBeenCalled();
    });

    it('scopes the duplicate check to the buyer', async () => {
      // Two buyers may both save the same vehicle; only the same buyer twice
      // is a conflict.
      favouritesRepository.findFavourite.mockResolvedValue(null);
      favouritesRepository.createFavourite.mockResolvedValue({});

      await service.addFavourite('buyer-1', 'v-1');

      expect(favouritesRepository.findFavourite).toHaveBeenCalledWith('buyer-1', 'v-1');
    });
  });

  describe('getMyFavourites', () => {
    it('returns the buyer\'s own rows', async () => {
      favouritesRepository.findByBuyer.mockResolvedValue([{ id: 'f-1' }]);

      await expect(service.getMyFavourites('buyer-1')).resolves.toEqual([{ id: 'f-1' }]);
      expect(favouritesRepository.findByBuyer).toHaveBeenCalledWith('buyer-1');
    });

    describe('photos', () => {
      type Saved = { id: string; vehicleId: string; vehicle: Record<string, unknown> };

      const saved = (vehicleId: string): Saved => ({
        id: `f-${vehicleId}`,
        vehicleId,
        vehicle: { id: vehicleId, make: 'Toyota', model: 'Aqua' },
      });

      beforeEach(() => {
        // Echo the key back as a URL so assertions show which path was resolved.
        imageUrlResolver.resolve.mockImplementation((key: string | null) =>
          Promise.resolve(key ? `/images/local/${key}` : null),
        );
      });

      it('adds imageUrl and thumbnailUrl to each saved vehicle', async () => {
        favouritesRepository.findByBuyer.mockResolvedValue([saved('v-1')]);
        favouritesRepository.findPrimaryImagePaths.mockResolvedValue(
          new Map([['v-1', { imagePath: 'images/a.jpg', thumbnailPath: 'images/a-thumb.jpg' }]]),
        );

        const [result] = (await service.getMyFavourites('buyer-1')) as unknown as Saved[];

        expect(result.vehicle).toMatchObject({
          make: 'Toyota',
          imageUrl: '/images/local/images/a.jpg',
          thumbnailUrl: '/images/local/images/a-thumb.jpg',
        });
      });

      it('fetches the photos for every saved vehicle in one query', async () => {
        favouritesRepository.findByBuyer.mockResolvedValue([saved('v-1'), saved('v-2')]);
        favouritesRepository.findPrimaryImagePaths.mockResolvedValue(new Map());

        await service.getMyFavourites('buyer-1');

        expect(favouritesRepository.findPrimaryImagePaths).toHaveBeenCalledTimes(1);
        expect(favouritesRepository.findPrimaryImagePaths).toHaveBeenCalledWith(['v-1', 'v-2']);
      });

      it('leaves both URLs null for a vehicle with no photo, so the card shows its placeholder', async () => {
        favouritesRepository.findByBuyer.mockResolvedValue([saved('v-1')]);
        favouritesRepository.findPrimaryImagePaths.mockResolvedValue(new Map());

        const [result] = (await service.getMyFavourites('buyer-1')) as unknown as Saved[];

        expect(result.vehicle).toMatchObject({ imageUrl: null, thumbnailUrl: null });
      });

      it('matches each photo to its own vehicle', async () => {
        favouritesRepository.findByBuyer.mockResolvedValue([saved('v-1'), saved('v-2')]);
        favouritesRepository.findPrimaryImagePaths.mockResolvedValue(
          new Map([['v-2', { imagePath: 'images/two.jpg', thumbnailPath: null }]]),
        );

        const [first, second] = (await service.getMyFavourites('buyer-1')) as unknown as Saved[];

        expect(first.vehicle).toMatchObject({ imageUrl: null });
        expect(second.vehicle).toMatchObject({
          imageUrl: '/images/local/images/two.jpg',
          thumbnailUrl: null,
        });
      });

      it("keeps each favourite row's own fields and the newest-first order", async () => {
        favouritesRepository.findByBuyer.mockResolvedValue([saved('v-1'), saved('v-2')]);
        favouritesRepository.findPrimaryImagePaths.mockResolvedValue(new Map());

        const result = (await service.getMyFavourites('buyer-1')) as unknown as Saved[];

        expect(result.map((r) => r.id)).toEqual(['f-v-1', 'f-v-2']);
        expect(result[0].vehicleId).toBe('v-1');
      });

      it('does not query for photos when the buyer has nothing saved', async () => {
        favouritesRepository.findByBuyer.mockResolvedValue([]);

        await expect(service.getMyFavourites('buyer-1')).resolves.toEqual([]);
        expect(favouritesRepository.findPrimaryImagePaths).not.toHaveBeenCalled();
      });
    });
  });

  describe('removeFavourite', () => {
    it('deletes and confirms', async () => {
      favouritesRepository.findFavourite.mockResolvedValue({ id: 'f-1' });

      await expect(service.removeFavourite('buyer-1', 'v-1')).resolves.toEqual({
        message: 'Vehicle removed from favourites',
      });
      expect(favouritesRepository.deleteFavourite).toHaveBeenCalledWith('buyer-1', 'v-1');
    });

    it('404s when there is nothing to remove', async () => {
      favouritesRepository.findFavourite.mockResolvedValue(null);

      await expect(service.removeFavourite('buyer-1', 'v-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not delete when the row is absent', async () => {
      // A delete on a non-existent composite key is harmless, but reaching it
      // would mean the 404 branch was skipped.
      favouritesRepository.findFavourite.mockResolvedValue(null);

      await expect(service.removeFavourite('buyer-1', 'v-1')).rejects.toThrow();

      expect(favouritesRepository.deleteFavourite).not.toHaveBeenCalled();
    });

    it('cannot remove another buyer\'s favourite', async () => {
      // The lookup is scoped by buyer, so another buyer's row reads as absent.
      favouritesRepository.findFavourite.mockResolvedValue(null);

      await expect(service.removeFavourite('buyer-2', 'v-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(favouritesRepository.findFavourite).toHaveBeenCalledWith('buyer-2', 'v-1');
    });
  });
});
