import { ConflictException } from '@nestjs/common';

import { ACTIVE_REGISTRATION_INDEX } from './listing-expiry';

const UNIQUE_VIOLATION = '23505';

export const REGISTRATION_CONFLICT_MESSAGE =
  'This registration number is already listed as an active vehicle. ' +
  'Archive or delete the existing listing before listing the same car again.';

/** True when a write failed on the one-active-listing-per-registration index. */
export function isActiveRegistrationConflict(err: unknown): boolean {
  const pg = err as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  } | null;
  const code = pg?.driverError?.code ?? pg?.code;
  const constraint = pg?.driverError?.constraint ?? pg?.constraint;
  return code === UNIQUE_VIOLATION && constraint === ACTIVE_REGISTRATION_INDEX;
}

/**
 * Runs a write that may claim a registration. The unique index is the real
 * guard against two active listings racing for the same car; this turns its
 * violation into a clear conflict instead of an internal error.
 */
export async function guardRegistration<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isActiveRegistrationConflict(err)) {
      throw new ConflictException(REGISTRATION_CONFLICT_MESSAGE);
    }
    throw err;
  }
}
