import { createLoadStage } from '../../../../src/workers/etl-worker/pipeline/persistence/load.stage';
import type {
  EmbeddedRow,
  StageContext,
  VehicleFields,
} from '../../../../src/workers/etl-worker/pipeline/types';

const row = (overrides: Partial<VehicleFields> = {}): EmbeddedRow => ({
  rowNumber: 1,
  raw: {},
  normalized: {
    vehicleType: 'CAR',
    make: 'Toyota',
    model: 'Vitz',
    condition: 'USED',
    manufactureYear: 2015,
    price: 3_500_000,
    mileage: 45_000,
    ...overrides,
  },
  confidence: 1,
  searchText: 'Toyota Vitz 2015 CAR',
  embedding: '[0.1,0.2]',
});

const ctx = { jobId: 'job-1', dealerId: 'dealer-1' } as never as StageContext;

describe('createLoadStage', () => {
  it('passes the job and dealer from the context, not the rows', async () => {
    // dealer_id must come from the job. A dealer_id column in an uploaded file
    // must not be able to assign stock to another dealer.
    const upsertBatch = jest.fn().mockResolvedValue({ loaded: [], rejections: [] });
    const stage = createLoadStage({ upsertBatch } as never);

    await stage.run(ctx, [row()]);

    expect(upsertBatch).toHaveBeenCalledWith('job-1', 'dealer-1', [expect.anything()]);
  });

  it('returns what the adapter loaded and rejected', async () => {
    const loaded = [{ id: 'v1', registration_number: 'CAB-1' }];
    const rejections = [{ rowNumber: 2, rawData: {}, reason: 'already listed' }];
    const stage = createLoadStage({
      upsertBatch: jest.fn().mockResolvedValue({ loaded, rejections }),
    } as never);

    await expect(stage.run(ctx, [row()])).resolves.toEqual({ loaded, rejections });
  });

  it('does not call the adapter for an empty chunk', async () => {
    const upsertBatch = jest.fn();
    const stage = createLoadStage({ upsertBatch } as never);

    await stage.run(ctx, []);

    expect(upsertBatch).not.toHaveBeenCalled();
  });

  it('is registered as the LOAD stage', () => {
    expect(createLoadStage({} as never).stage).toBe('LOAD');
  });
});
