import { ConflictException, NotFoundException } from '@nestjs/common';
import { FavouritesService } from '../../../../src/modules/favourites/services/favourites.service';

describe('FavouritesService', () => {
  const favouritesRepository = {
    findFavourite: jest.fn(),
    createFavourite: jest.fn(),
    findByBuyer: jest.fn(),
    deleteFavourite: jest.fn(),
  };
  const service = new FavouritesService(favouritesRepository as never);

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
