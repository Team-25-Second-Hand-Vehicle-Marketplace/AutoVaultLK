import { ListingLifecycleService, LIFECYCLE_BATCH_SIZE } from '../../../src/modules/listings/services/listing-lifecycle.service';

describe('ListingLifecycleService', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  function rows(n: number) {
    return Array.from({ length: n }, (_, i) => ({ id: `r-${i}` }));
  }

  it('keeps archiving batches until a short batch signals the backlog is clear', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce(rows(LIFECYCLE_BATCH_SIZE))
        .mockResolvedValueOnce(rows(7)),
    };
    const service = new ListingLifecycleService(dataSource as never);

    await expect(service.archiveExpired(now)).resolves.toBe(LIFECYCLE_BATCH_SIZE + 7);
    expect(dataSource.query).toHaveBeenCalledTimes(2);
    expect(dataSource.query.mock.calls[0][1]).toEqual([now, LIFECYCLE_BATCH_SIZE]);
  });

  it('purges snapshots in the same batched way', async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce(rows(3)) };
    const service = new ListingLifecycleService(dataSource as never);

    await expect(service.purgeSnapshots(now)).resolves.toBe(3);
    expect(dataSource.query.mock.calls[0][0]).toContain('deleted_listing_snapshots');
  });

  it('reports archived and purged counts from the daily run', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce(rows(2)) // archive batch
        .mockResolvedValueOnce(rows(1)), // purge batch
    };
    const service = new ListingLifecycleService(dataSource as never);

    await expect(service.runDailyJobs(now)).resolves.toEqual({ archived: 2, purged: 1 });
  });
});
