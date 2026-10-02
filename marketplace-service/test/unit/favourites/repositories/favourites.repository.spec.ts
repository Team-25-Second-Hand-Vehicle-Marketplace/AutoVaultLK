import { FavouritesRepository } from '../../../../src/modules/favourites/repositories/favourites.repository';

describe('FavouritesRepository', () => {
  const repo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
    manager: { query: jest.fn() },
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

  describe('findPrimaryImagePaths', () => {
    it('returns an empty map without querying when there are no vehicles', async () => {
      await expect(repository.findPrimaryImagePaths([])).resolves.toEqual(new Map());
      expect(repo.manager.query).not.toHaveBeenCalled();
    });

    it('asks for one primary image per vehicle, in a single statement', async () => {
      repo.manager.query.mockResolvedValue([]);

      await repository.findPrimaryImagePaths(['v-1', 'v-2']);

      expect(repo.manager.query).toHaveBeenCalledTimes(1);
      const [sql, params] = repo.manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/DISTINCT ON \(vi\.vehicle_id\)/);
      // Primary first, then display order: the same choice search makes.
      expect(sql).toMatch(/ORDER BY vi\.vehicle_id, vi\.is_primary DESC, vi\.display_order ASC/);
      expect(sql).toMatch(/COALESCE\(vi\.processed_path, vi\.s3_path\)/);
      expect(params).toEqual([['v-1', 'v-2']]);
    });

    it('maps rows to paths keyed by vehicle id', async () => {
      repo.manager.query.mockResolvedValue([
        { vehicle_id: 'v-1', image_path: 'images/a.jpg', thumbnail_path: 'images/a-t.jpg' },
        { vehicle_id: 'v-2', image_path: 'images/b.jpg', thumbnail_path: null },
      ]);

      const result = await repository.findPrimaryImagePaths(['v-1', 'v-2', 'v-3']);

      expect(result.get('v-1')).toEqual({
        imagePath: 'images/a.jpg',
        thumbnailPath: 'images/a-t.jpg',
      });
      expect(result.get('v-2')).toEqual({ imagePath: 'images/b.jpg', thumbnailPath: null });
      // No row for a vehicle with no photo - the caller treats absence as "no photo".
      expect(result.has('v-3')).toBe(false);
    });
  });
});
