import { RecommendationsRepository } from '../../../../src/modules/recommendations/repositories/recommendations.repository';

/** One full row as Postgres returns it — snake_case, numerics as strings. */
const ROW = {
  id: 'v-1',
  vehicle_type: 'CAR',
  make: 'Toyota',
  model: 'Vitz',
  manufacture_year: 2015,
  registration_year: 2016,
  price: '3500000.00',
  mileage: 45000,
  fuel_type: 'PETROL',
  transmission_type: 'AUTOMATIC',
  location_city: 'Nugegoda',
  location_district: 'Colombo',
  condition: 'USED',
  image_path: '/img/1.jpg',
  thumbnail_path: '/img/1-thumb.jpg',
  dealer_verified: true,
  similarity_score: '0.87',
};

describe('RecommendationsRepository', () => {
  const dataSource = { query: jest.fn() };
  const repository = new RecommendationsRepository(dataSource as never);

  beforeEach(() => jest.clearAllMocks());

  describe('vehicleExists', () => {
    it('is true when the row exists', async () => {
      dataSource.query.mockResolvedValue([{ exists: true }]);

      await expect(repository.vehicleExists('v-1')).resolves.toBe(true);
      expect(dataSource.query.mock.calls[0][1]).toEqual(['v-1']);
    });

    it('is false when it does not', async () => {
      dataSource.query.mockResolvedValue([{ exists: false }]);

      await expect(repository.vehicleExists('v-1')).resolves.toBe(false);
    });

    it('is false for an empty result rather than throwing', async () => {
      // SELECT EXISTS always returns a row, but the optional chain is the
      // difference between a false and a TypeError if that ever changes.
      dataSource.query.mockResolvedValue([]);

      await expect(repository.vehicleExists('v-1')).resolves.toBe(false);
    });

    it('is false for a truthy non-boolean', async () => {
      // pg can hand back 't' rather than true depending on driver config; the
      // strict === true is what makes that safe.
      dataSource.query.mockResolvedValue([{ exists: 't' }]);

      await expect(repository.vehicleExists('v-1')).resolves.toBe(false);
    });
  });

  describe('findSimilarVehicles', () => {
    it('passes the vehicle id and limit as parameters', async () => {
      dataSource.query.mockResolvedValue([]);

      await repository.findSimilarVehicles('v-1', 6);

      expect(dataSource.query.mock.calls[0][1]).toEqual(['v-1', 6]);
    });

    it('maps every column from snake_case to camelCase', async () => {
      dataSource.query.mockResolvedValue([ROW]);

      const [result] = await repository.findSimilarVehicles('v-1', 6);

      expect(result).toEqual({
        id: 'v-1',
        vehicleType: 'CAR',
        make: 'Toyota',
        model: 'Vitz',
        manufactureYear: 2015,
        registrationYear: 2016,
        price: 3_500_000,
        mileage: 45000,
        fuelType: 'PETROL',
        transmissionType: 'AUTOMATIC',
        locationCity: 'Nugegoda',
        locationDistrict: 'Colombo',
        condition: 'USED',
        imageUrl: '/img/1.jpg',
        thumbnailUrl: '/img/1-thumb.jpg',
        dealerVerified: true,
        similarityScore: 0.87,
      });
    });

    it('coerces numerics from strings', async () => {
      // pg returns numeric and double precision as strings. Left as-is, the
      // frontend would sort prices lexicographically — "900000" above
      // "3500000".
      dataSource.query.mockResolvedValue([ROW]);

      const [result] = await repository.findSimilarVehicles('v-1', 6);

      expect(typeof result.price).toBe('number');
      expect(typeof result.similarityScore).toBe('number');
    });

    it('treats a null dealer_verified as false', async () => {
      // The column comes from a LEFT JOIN, so null means "no dealer profile",
      // which is not the same as verified.
      dataSource.query.mockResolvedValue([{ ...ROW, dealer_verified: null }]);

      const [result] = await repository.findSimilarVehicles('v-1', 6);

      expect(result.dealerVerified).toBe(false);
    });

    it('returns an empty list when nothing is similar', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(repository.findSimilarVehicles('v-1', 6)).resolves.toEqual([]);
    });
  });
});
