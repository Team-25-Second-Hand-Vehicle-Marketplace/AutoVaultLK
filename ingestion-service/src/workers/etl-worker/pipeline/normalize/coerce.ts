/**
 * Numeric coercion for dealer-supplied cells.
 *
 * Dealers type prices the way they say them: "Rs. 3,500,000/=", "3.5M",
 * "45,000 km", "1500cc". None of these are numbers to JavaScript, and
 * Number("Rs. 3,500,000") is NaN — which would reject a perfectly good row over
 * a currency prefix. Every rule here exists because the alternative is throwing
 * away real stock.
 *
 * Returns null rather than NaN or 0 for anything unparseable. Null is a missing
 * value the validate stage can reject with a reason; 0 is a price.
 */

/** "Rs.", "LKR", "SLR", "/=" — currency decoration around the digits. */
const CURRENCY = /(?:^|\s)(?:rs\.?|lkr|slr|₨)\s*|\s*\/=\s*$/gi;

/** Unit suffixes. `cc` must be stripped before `c`-anything else is read. */
const UNITS = /\s*(?:kms?|kilometers?|kilometres?|cc|c\.c\.|km\/h|miles?)\s*$/gi;

/**
 * Shorthand magnitudes. "3.5M" and "45K" are common in dealer sheets and mean
 * exactly what they look like; treating them as unparseable would reject rows
 * whose price is perfectly clear to any human reader.
 */
const SHORTHAND = /^([\d.]+)\s*(k|m|lakhs?|lacs?|crores?|mn)$/i;

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  mn: 1_000_000,
  lakh: 100_000,
  lakhs: 100_000,
  lac: 100_000,
  lacs: 100_000,
  crore: 10_000_000,
  crores: 10_000_000,
};

/**
 * Parses a decimal number from a dealer cell.
 *
 * Thousands separators are stripped only when they sit in valid positions
 * ("3,500,000"). A cell like "3,5" is European decimal notation or a typo —
 * either way, stripping the comma would turn 3.5 into 35, a tenfold error in a
 * price. Ambiguity returns null and lets the row be rejected honestly.
 */
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

  // Spaces as separators ("3 500 000") are unambiguous — no decimal reading.
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

/**
 * Years, tolerating the two-digit form dealers still type.
 *
 * "98" means 1998 and "15" means 2015; the split point is the current year's
 * last two digits, since no dealer lists a vehicle from the future. Four-digit
 * years pass through untouched — range checking belongs to validateRows, which
 * can attach a rejection reason.
 */
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

/**
 * Sri Lankan registration numbers, upper-cased with a single separating dash.
 *
 * Dealers write "cab 1234", "CAB-1234" and "CAB1234" for the same vehicle.
 * These are compared against the UNIQUE partial index on registration_number
 * (FR-35.1), so an inconsistent format would let the same vehicle be listed
 * twice — the exact duplicate the index exists to prevent.
 */
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
