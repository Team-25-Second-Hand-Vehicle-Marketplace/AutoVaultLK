import { FavouritesRepository } from '../../../../src/modules/favourites/repositories/favourites.repository';

describe('FavouritesRepository', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
  };
  const repository = new FavouritesRepository(repo as never);

  beforeEach(() => jest.clearAllMocks());

  describe('createFavourite', () => {
    it('builds the entity before saving it', () => {
      // create() then save(entity), not save({...}) directly: TypeORM applies
      // column defaults and transformers in create, so collapsing the two
      // would skip them.
      const entity = { buyerId: 'buyer-1', vehicleId: 'v-1' };
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue({ ...entity, id: 'f-1' });

      void repository.createFavourite('buyer-1', 'v-1');

      expect(repo.create).toHaveBeenCalledWith({ buyerId: 'buyer-1', vehicleId: 'v-1' });
      expect(repo.save).toHaveBeenCalledWith(entity);
    });

    it('returns the saved row', async () => {
      repo.create.mockReturnValue({});
      repo.save.mockResolvedValue({ id: 'f-1' });

      await expect(repository.createFavourite('buyer-1', 'v-1')).resolves.toEqual({
        id: 'f-1',
      });
    });
  });

  describe('findFavourite', () => {
    it('looks up the composite key', async () => {
      repo.findOne.mockResolvedValue(null);

      await repository.findFavourite('buyer-1', 'v-1');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { buyerId: 'buyer-1', vehicleId: 'v-1' },
      });
    });
  });

  describe('findByBuyer', () => {
    it('joins the vehicle and orders newest first', async () => {
      // Both are user-visible: without the relation the list renders empty
      // cards, and without the order it renders in insertion order.
      repo.find.mockResolvedValue([]);

      await repository.findByBuyer('buyer-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { buyerId: 'buyer-1' },
        relations: { vehicle: true },
        order: { createdAt: 'DESC' },
      });
    });

    it('passes an empty result through unchanged', async () => {
      repo.find.mockResolvedValue([]);

      await expect(repository.findByBuyer('buyer-1')).resolves.toEqual([]);
    });
  });

  describe('deleteFavourite', () => {
    it('deletes by the composite key', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });

      await repository.deleteFavourite('buyer-1', 'v-1');

      expect(repo.delete).toHaveBeenCalledWith({ buyerId: 'buyer-1', vehicleId: 'v-1' });
    });

    it('resolves undefined rather than the DeleteResult', async () => {
      // The service treats a missing row as a 404 by checking first, so the
      // affected count here is deliberately not propagated.
      repo.delete.mockResolvedValue({ affected: 0 });

      await expect(repository.deleteFavourite('buyer-1', 'v-1')).resolves.toBeUndefined();
    });
  });
});
