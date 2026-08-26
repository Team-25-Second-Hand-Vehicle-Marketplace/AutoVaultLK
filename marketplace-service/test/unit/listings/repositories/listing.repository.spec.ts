import { ListingRepository } from '../../../../src/modules/listings/repositories/listing.repository';
import type { Vehicle } from '../../../../src/infrastructure/database/entities/vehicle.entity';

describe('ListingRepository', () => {
  const vehicleRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const repository = new ListingRepository(vehicleRepo as never);

  beforeEach(() => jest.clearAllMocks());

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

      await repository.create({ dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never, 'LIVE');

      expect(vehicleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ vehicleType: 'CAR', condition: 'USED', status: 'LIVE' }),
      );
    });

    it('defaults registrationYear to null and description to null when omitted', async () => {
      vehicleRepo.create.mockReturnValue(vehicle());
      vehicleRepo.save.mockResolvedValue(vehicle());

      await repository.create({ dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never, 'DRAFT');

      expect(vehicleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ registrationYear: null, description: null, specs: {} }),
      );
    });

    it('persists via repo.save, not just repo.create', async () => {
      const created = vehicle();
      vehicleRepo.create.mockReturnValue(created);
      vehicleRepo.save.mockResolvedValue(created);

      await repository.create({ dealerId: 'dealer-1', make: 'Toyota', model: 'Aqua' } as never, 'LIVE');

      expect(vehicleRepo.save).toHaveBeenCalledWith(created);
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

  describe('findById', () => {
    it('looks up by id with no status filter (so DRAFT/ARCHIVED are still found by owners)', async () => {
      vehicleRepo.findOne.mockResolvedValue(vehicle());

      await repository.findById('v-1');

      expect(vehicleRepo.findOne).toHaveBeenCalledWith({ where: { id: 'v-1' } });
    });
  });

  describe('update', () => {
    it('returns null when the listing does not exist, without calling save', async () => {
      vehicleRepo.findOne.mockResolvedValue(null);

      await expect(repository.update('missing', { make: 'Honda' })).resolves.toBeNull();
      expect(vehicleRepo.save).not.toHaveBeenCalled();
    });

    it('only overwrites fields present in the patch, leaving the rest untouched', async () => {
      const existing = vehicle({ make: 'Toyota', model: 'Aqua', price: 5_000_000 });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.update('v-1', { make: 'Honda' });

      expect(result).toMatchObject({ make: 'Honda', model: 'Aqua', price: 5_000_000 });
    });

    it('coalesces an explicit null description but leaves other fields alone', async () => {
      const existing = vehicle({ description: 'Great car' });
      vehicleRepo.findOne.mockResolvedValue(existing);
      vehicleRepo.save.mockImplementation((v) => Promise.resolve(v));

      const result = await repository.update('v-1', { description: undefined });

      // description was not in the patch (undefined), so it must be untouched
      expect(result).toMatchObject({ description: 'Great car' });
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
});
