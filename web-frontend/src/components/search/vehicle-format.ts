
export function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(price)
}

export function formatMileage(km: number): string {
  return `${new Intl.NumberFormat('en-LK').format(km)} km`
}

/** "THREE_WHEELER" → "THREE WHEELER" for display. */
export function humanizeEnum(value: string): string {
  return value.replace(/_/g, ' ')
}
