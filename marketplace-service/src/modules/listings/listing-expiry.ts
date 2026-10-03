/** A LIVE listing stays visible for this many days, then the expiry job archives it. */
export const LISTING_TERM_DAYS = 90;

/** How far ahead a listing must be expiring to be picked up for a renewal reminder. */
export const EXPIRY_REMINDER_DAYS = 5;

/** Name of the partial unique index that enforces one active listing per registration. */
export const ACTIVE_REGISTRATION_INDEX = 'idx_vehicles_active_registration_number';

/** Snapshot of a permanently deleted listing is kept this long for dispute review. */
export const DELETED_SNAPSHOT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

/** Expiry for a listing that goes LIVE at `publishedAt`. */
export function termFrom(publishedAt: Date): Date {
  return addDays(publishedAt, LISTING_TERM_DAYS);
}

/**
 * New expiry when a listing is renewed. The term runs from whichever is later,
 * the current expiry or now: an expiring listing gains 90 days from its expiry
 * day, and a listing that has already lapsed starts a fresh term from today.
 */
export function renewedExpiry(currentExpiry: Date | null, now: Date): Date {
  const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
  return addDays(base, LISTING_TERM_DAYS);
}
