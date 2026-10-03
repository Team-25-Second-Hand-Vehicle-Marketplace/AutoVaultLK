import { LISTING_TERM_DAYS, termFrom } from '../../../src/modules/listings/listing-expiry';

describe('listing expiry', () => {
  it('gives a LIVE listing a 90-day term from its publish time', () => {
    const published = new Date('2026-01-01T10:00:00Z');
    const expires = termFrom(published);

    expect(LISTING_TERM_DAYS).toBe(90);
    expect(expires.toISOString()).toBe('2026-04-01T10:00:00.000Z');
  });
});
