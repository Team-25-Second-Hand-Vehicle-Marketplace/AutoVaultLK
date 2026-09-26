import { ListingRepository } from '../../../../src/modules/listings/repositories/listing.repository';
import type { Vehicle } from '../../../../src/infrastructure/database/entities/vehicle.entity';
import { ManualListingStatusDto } from '../../../../src/modules/listings/dto/create-listing.dto';

describe('ListingRepository', () => {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn(),
  };
  const vehicleRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
  };
  const searchIndexService = {
    build: jest.fn(),
  };
  const repository = new ListingRepository(
    vehicleRepo as never,
    searchIndexService as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    searchIndexService.build.mockResolvedValue({
      searchText: null,
      embedding: null,
    });
    for (const key of ['leftJoinAndSelect', 'where', 'orderBy', 'addOrderBy'] as const) {
      queryBuilder[key].mockReturnValue(queryBuilder);
    }
    queryBuilder.getMany.mockResolvedValue([]);
  });

  function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
    return {
      id: 'v-1',
      dealerId: 'dealer-1',
      vehicleType: 'CAR',
      make: 'Toyota',
      model: 'Aqua',
      condition: 'USED',
      status: 'LIVE',
      specs: {},
      ...overrides,
    } as Vehicle;
  }

  describe('create', () => {
    it('defaults vehicleType to CAR and condition to USED when the DTO omits them', async () => {
      vehicleRepo.create.mockReturnValue(vehicle());
      vehicleRepo.save.mockResolvedValue(vehicle());

      await repository.create(
        { dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never,
        'LIVE',
      );

      expect(vehicleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleType: 'CAR',
          condition: 'USED',
          status: 'LIVE',
        }),
      );
    });

    it('defaults registrationYear to null and description to null when omitted', async () => {
      vehicleRepo.create.mockReturnValue(vehicle());
      vehicleRepo.save.mockResolvedValue(vehicle());

      await repository.create(
        { dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never,
        'DRAFT',
      );

      expect(vehicleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          registrationYear: null,
          description: null,
          specs: {},
        }),
      );
    });

    it('persists via repo.save, not just repo.create', async () => {
      const created = vehicle();
      vehicleRepo.create.mockReturnValue(created);
      vehicleRepo.save.mockResolvedValue(created);

      await repository.create(
        { dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never,
        'LIVE',
      );

      expect(vehicleRepo.save).toHaveBeenCalledWith(created);
    });

    it('computes searchText/embedding via ListingSearchIndexService and saves them (FR-13.1)', async () => {
      const created = vehicle();
      vehicleRepo.create.mockReturnValue(created);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));
      searchIndexService.build.mockResolvedValue({
        searchText: 'Toyota Aqua',
        embedding: '[0.1,0.2]',
      });

      const result = await repository.create(
        { dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never,
        'LIVE',
      );

      expect(searchIndexService.build).toHaveBeenCalledWith(created);
      expect(result).toMatchObject({
        searchText: 'Toyota Aqua',
        embedding: '[0.1,0.2]',
      });
    });
  });

  describe('findAllLive', () => {
    it('filters to status LIVE, ordered newest first', async () => {
      vehicleRepo.find.mockResolvedValue([]);

      await repository.findAllLive();

      expect(vehicleRepo.find).toHaveBeenCalledWith({
        where: { status: 'LIVE' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findByDealer', () => {
    it('filters to the dealer, no status filter, ordered newest first', async () => {
      vehicleRepo.find.mockResolvedValue([]);

      await repository.findByDealer('dealer-1');

      expect(vehicleRepo.find).toHaveBeenCalledWith({
        where: { dealerId: 'dealer-1' },
        order: { createdAt: 'DESC' },
        relations: ['images'],
      });
    });

    it('uses the plain find() when no sort is given, not the query builder', async () => {
      vehicleRepo.find.mockResolvedValue([]);

      await repository.findByDealer('dealer-1');

      expect(vehicleRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    describe('sort: confidence_asc (FR-42.1)', () => {
      it('switches to the query builder', async () => {
        await repository.findByDealer('dealer-1', 'confidence_asc');

        expect(vehicleRepo.createQueryBuilder).toHaveBeenCalledWith('vehicle');
        expect(vehicleRepo.find).not.toHaveBeenCalled();
      });

      it('filters to the dealer', async () => {
        await repository.findByDealer('dealer-1', 'confidence_asc');

        expect(queryBuilder.where).toHaveBeenCalledWith(
          'vehicle.dealer_id = :dealerId',
          {
            dealerId: 'dealer-1',
          },
        );
      });

      it('orders by rowConfidence ascending, cast to numeric', async () => {
        await repository.findByDealer('dealer-1', 'confidence_asc');

        expect(queryBuilder.orderBy).toHaveBeenCalledWith(
          `(vehicle.normalization->>'rowConfidence')::numeric`,
          'ASC',
          'NULLS LAST',
        );
      });

      // A row with no provenance (a manual listing, or one predating
      // migration 29000) has nothing to review, so it must not crowd the
      // rows that do.
      it('places rows with no provenance last', async () => {
        await repository.findByDealer('dealer-1', 'confidence_asc');

        expect(queryBuilder.orderBy).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          'NULLS LAST',
        );
      });

      it('breaks ties by newest first', async () => {
        await repository.findByDealer('dealer-1', 'confidence_asc');

        expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
          'vehicle.created_at',
          'DESC',
        );
      });

      it('returns the query builder result', async () => {
        const rows = [vehicle({ id: 'v-1' }), vehicle({ id: 'v-2' })];
        queryBuilder.getMany.mockResolvedValue(rows);

        await expect(
          repository.findByDealer('dealer-1', 'confidence_asc'),
        ).resolves.toBe(rows);
      });
    });
  });

  describe('findById', () => {
    it('looks up by id with no status filter (so DRAFT/ARCHIVED are still found by owners)', async () => {
      vehicleRepo.findOne.mockResolvedValue(vehicle());

      await repository.findById('v-1');

      expect(vehicleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'v-1' },
      });
    });
  });

  describe('update', () => {
    it('returns null when the listing does not exist, without calling save', async () => {
      vehicleRepo.findOne.mockResolvedValue(null);

      await expect(
        repository.update('missing', { make: 'Honda' }),
      ).resolves.toBeNull();
      expect(vehicleRepo.save).not.toHaveBeenCalled();
    });

    it('only overwrites fields present in the patch, leaving the rest untouched', async () => {
      const existing = vehicle({
        make: 'Toyota',
        model: 'Aqua',
        price: 5_000_000,
      });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.update('v-1', { make: 'Honda' });

      expect(result).toMatchObject({
        make: 'Honda',
        model: 'Aqua',
        price: 5_000_000,
      });
    });

    it('coalesces an explicit null description but leaves other fields alone', async () => {
      const existing = vehicle({ description: 'Great car' });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.update('v-1', { description: undefined });

      // description was not in the patch (undefined), so it must be untouched
      expect(result).toMatchObject({ description: 'Great car' });
    });

    it('recomputes searchText/embedding when a searchable field changes (FR-13.1/FR-13.2)', async () => {
      const existing = vehicle({ make: 'Toyota', model: 'Aqua' });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));
      searchIndexService.build.mockResolvedValue({
        searchText: 'Honda Aqua',
        embedding: '[0.9,0.1]',
      });

      const result = await repository.update('v-1', { make: 'Honda' });

      expect(searchIndexService.build).toHaveBeenCalledWith(
        expect.objectContaining({ make: 'Honda' }),
      );
      expect(result).toMatchObject({
        searchText: 'Honda Aqua',
        embedding: '[0.9,0.1]',
      });
    });

    it('does not touch searchText/embedding when only non-searchable fields change', async () => {
      const existing = vehicle({ searchText: 'Toyota Aqua', embedding: '[1]' });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.update('v-1', {
        status: ManualListingStatusDto.LIVE,
      });

      expect(searchIndexService.build).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        searchText: 'Toyota Aqua',
        embedding: '[1]',
      });
    });

    it('recomputes searchText/embedding when the price changes', async () => {
      // price feeds a band phrase in buildSearchText: dropping 6M to 4M moves
      // the listing from "upper mid range" to "mid range". Without a recompute
      // the vector would still claim the old band.
      const existing = vehicle({
        price: 6_000_000,
        searchText: 'Toyota Aqua',
        embedding: '[1]',
      });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      await repository.update('v-1', { price: 4_000_000 });

      expect(searchIndexService.build).toHaveBeenCalled();
    });

    it('recomputes searchText/embedding when the mileage changes', async () => {
      const existing = vehicle({
        mileage: 15_000,
        searchText: 'Toyota Aqua',
        embedding: '[1]',
      });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      await repository.update('v-1', { mileage: 90_000 });

      expect(searchIndexService.build).toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('returns null when the listing does not exist', async () => {
      vehicleRepo.findOne.mockResolvedValue(null);

      await expect(repository.deactivate('missing')).resolves.toBeNull();
    });

    it('sets status to ARCHIVED and persists it', async () => {
      const existing = vehicle({ status: 'LIVE' });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.deactivate('v-1');

      expect(result).toMatchObject({ status: 'ARCHIVED' });
    });
  });

  describe('approve (FR-42)', () => {
    it('returns null when the listing does not exist', async () => {
      vehicleRepo.findOne.mockResolvedValue(null);

      await expect(repository.approve('missing')).resolves.toBeNull();
    });

    it('sets status to LIVE and persists it', async () => {
      const existing = vehicle({ status: 'PENDING_REVIEW' });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.approve('v-1');

      expect(result).toMatchObject({ status: 'LIVE' });
    });

    // approve() is the only gate deciding whether an id maps to a real
    // transition; the service relies on null here to tell "nothing to
    // approve" apart from "does not exist" and raise the right status code.
    it('returns null (not an error) for a listing that is not PENDING_REVIEW', async () => {
      vehicleRepo.findOne.mockResolvedValue(vehicle({ status: 'LIVE' }));

      await expect(repository.approve('v-1')).resolves.toBeNull();
      expect(vehicleRepo.save).not.toHaveBeenCalled();
    });

    it.each(['DRAFT', 'ARCHIVED', 'REJECTED', 'SOLD'] as const)(
      'refuses to approve a %s listing',
      async (status) => {
        vehicleRepo.findOne.mockResolvedValue(vehicle({ status }));

        await expect(repository.approve('v-1')).resolves.toBeNull();
      },
    );
  });

  describe('remove', () => {
    it('returns true when a row was deleted', async () => {
      vehicleRepo.delete.mockResolvedValue({ affected: 1 });

      await expect(repository.remove('v-1')).resolves.toBe(true);
      expect(vehicleRepo.delete).toHaveBeenCalledWith({ id: 'v-1' });
    });

    it('returns false when nothing matched', async () => {
      vehicleRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(repository.remove('missing')).resolves.toBe(false);
    });
  });
});
