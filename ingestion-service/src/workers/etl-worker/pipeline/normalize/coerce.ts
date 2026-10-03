
/** "Rs.", "LKR", "SLR", "/=" - currency decoration around the digits. */
const CURRENCY = /(?:^|\s)(?:rs\.?|lkr|slr|₨)\s*|\s*\/=\s*$/gi;

/** Unit suffixes. `cc` must be stripped before `c`-anything else is read. */
const UNITS = /\s*(?:kms?|kilometers?|kilometres?|cc|c\.c\.|km\/h|miles?)\s*$/gi;

/**
 * Shorthand magnitudes. "3.5M" and "45K" are common in dealer sheets and mean
 * exactly what they look like; treating them as unparseable would reject rows
 * whose price is perfectly clear to any human reader.
 */
const SHORTHAND = /^([\d.]+)\s*(k|m|mil|mill|million|lakhs?|lacs?|crores?|mn)$/i;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  mil: 1_000_000,
  mill: 1_000_000,
  million: 1_000_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
};

export function coerceNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;

  let text = String(raw).trim();
  if (!text) return null;

  text = text.replace(CURRENCY, ' ').replace(UNITS, '').trim();
  if (!text) return null;

  const shorthand = SHORTHAND.exec(text);
  if (shorthand) {
    const base = Number(shorthand[1]);
    const multiplier = MULTIPLIERS[shorthand[2].toLowerCase()];
    if (!Number.isFinite(base) || !multiplier) return null;
    return base * multiplier;
  }

  // Grouped thousands: 1,234 / 12,345,678. Anything else keeps its commas and
  // fails the numeric test below rather than being silently reinterpreted.
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, '');
  }

  // Spaces as separators ("3 500 000") are unambiguous - no decimal reading.
  if (/^-?\d{1,3}( \d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/ /g, '');
  }

  if (!/^-?\d*\.?\d+$/.test(text)) return null;

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Whole numbers only. A fractional mileage or year is a data error, not a round. */
export function coerceInteger(raw: string | undefined | null): number | null {
  const value = coerceNumber(raw);
  if (value === null) return null;
  return Number.isInteger(value) ? value : null;
}

export function coerceYear(raw: string | undefined | null, now = new Date()): number | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const value = coerceInteger(text);
  if (value === null) return null;

  if (/^\d{2}$/.test(text)) {
    const century = Math.floor(now.getFullYear() / 100) * 100;
    const candidate = century + value;
    return candidate > now.getFullYear() + 1 ? candidate - 100 : candidate;
  }

  return value;
}

/**
 * Booleans as dealers write them. Anything unrecognised is null, not false:
 * "is this negotiable?" left blank means unknown, and defaulting to false is
 * the enrich stage's decision to make explicitly, not a parsing accident.
 */
export function coerceBoolean(raw: string | undefined | null): boolean | null {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return null;

  if (['true', 'yes', 'y', '1', 'negotiable'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'fixed', 'non-negotiable'].includes(text)) return false;

  return null;
}

/** Collapses internal whitespace and trims. Empty becomes null, never "". */
export function coerceText(raw: string | undefined | null): string | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

export function coerceRegistrationNumber(raw: string | undefined | null): string | null {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/[\s\-_/]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');

  if (!text) return null;

  // "CAB1234" → "CAB-1234". Only when the split is unambiguous: a run of
  // letters followed by a run of digits and nothing else.
  const joined = /^([A-Z]{2,3})(\d{3,4})$/.exec(text);
  return joined ? `${joined[1]}-${joined[2]}` : text;
}
