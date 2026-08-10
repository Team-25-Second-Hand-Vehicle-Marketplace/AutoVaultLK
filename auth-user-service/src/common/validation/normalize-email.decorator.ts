import { Transform } from 'class-transformer';

/** Lowercase + trim before format validation. */
export function NormalizeEmail() {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}
