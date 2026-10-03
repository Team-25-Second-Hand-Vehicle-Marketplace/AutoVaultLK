import { LISTING_TERM_DAYS, renewedExpiry, termFrom } from '../../../src/modules/listings/listing-expiry';

describe('listing expiry', () => {
  it('gives a LIVE listing a 90-day term from its publish time', () => {
    const published = new Date('2026-01-01T10:00:00Z');
    const expires = termFrom(published);

    expect(LISTING_TERM_DAYS).toBe(90);
    expect(expires.toISOString()).toBe('2026-04-01T10:00:00.000Z');
  });
});

describe('renewedExpiry', () => {
  const now = new Date('2026-03-01T00:00:00Z');

  it('adds 90 days to an expiry that is still in the future', () => {
    const expiry = new Date('2026-03-04T00:00:00Z');
    expect(renewedExpiry(expiry, now).toISOString()).toBe('2026-06-02T00:00:00.000Z');
  });

  it('starts a fresh 90-day term from today when the expiry has passed', () => {
    const lapsed = new Date('2026-01-10T00:00:00Z');
    expect(renewedExpiry(lapsed, now).toISOString()).toBe('2026-05-30T00:00:00.000Z');
  });
});
