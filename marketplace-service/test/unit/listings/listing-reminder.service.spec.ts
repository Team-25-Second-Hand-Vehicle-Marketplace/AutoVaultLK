import { ListingReminderService } from '../../../src/modules/listings/services/listing-reminder.service';

describe('ListingReminderService', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const expires = new Date('2026-06-04T09:00:00Z');

  function row(overrides: Record<string, unknown>) {
    return {
      id: 'listing-x',
      dealer_id: 'dealer-1',
      upload_job_id: null,
      make: 'Toyota',
      model: 'Aqua',
      expires_at: expires,
      ...overrides,
    };
  }

  function setup(rows: unknown[]) {
    const dataSource = { query: jest.fn().mockResolvedValue(rows) };
    const notifications = { emit: jest.fn().mockResolvedValue(true) };
    const service = new ListingReminderService(dataSource as never, notifications as never);
    return { service, notifications };
  }

  it('sends one email for a whole bulk batch, however many listings it has', async () => {
    const batch = Array.from({ length: 1000 }, (_, i) =>
      row({ id: `l-${i}`, upload_job_id: 'job-1' }),
    );
    const { service, notifications } = setup(batch);

    const result = await service.sendExpiryReminders(now);

    expect(notifications.emit).toHaveBeenCalledTimes(1);
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LISTING_EXPIRING_BATCH',
        userId: 'dealer-1',
        idempotencyKey: 'expiry-batch:job-1:2026-06-04',
        payload: { count: 1000, expiresOn: '2026-06-04' },
      }),
    );
    expect(result).toMatchObject({ batches: 1, singles: 0, sent: 1, failed: 0 });
  });

  it('sends one email per single listing', async () => {
    const { service, notifications } = setup([
      row({ id: 'a' }),
      row({ id: 'b', make: 'Honda', model: 'Vezel' }),
    ]);

    const result = await service.sendExpiryReminders(now);

    expect(notifications.emit).toHaveBeenCalledTimes(2);
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'LISTING_EXPIRING',
        idempotencyKey: 'expiry-listing:a:2026-06-04',
        payload: { listingTitle: 'Toyota Aqua', expiresOn: '2026-06-04' },
      }),
    );
    expect(result).toMatchObject({ batches: 0, singles: 2 });
  });

  it('counts failed sends so the run can report them', async () => {
    const { service, notifications } = setup([row({ id: 'a' }), row({ id: 'b' })]);
    notifications.emit.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(service.sendExpiryReminders(now)).resolves.toMatchObject({ sent: 1, failed: 1 });
  });
});
