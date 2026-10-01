
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(price)
}

export function formatMileage(km: number): string {
  return `${new Intl.NumberFormat('en-LK').format(km)} km`
}

/** "THREE_WHEELER" or "USED" -> "Three wheeler" or "Used", for table cells. */
export function sentenceCase(value: string | null): string {
  if (!value) return '-'
  // Values that are acronyms, not words, keep their capitals.
  if (ACRONYMS.has(value.toUpperCase())) return value.toUpperCase()
  const words = value.replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const ACRONYMS: ReadonlySet<string> = new Set(['SUV', 'CNG', 'CVT', 'ABS', 'FWD', 'RWD', 'AWD', '4WD'])

/** "THREE_WHEELER" → "THREE WHEELER" for display. */
export function humanizeEnum(value: string): string {
  return value.replace(/_/g, ' ')
}
