/**
 * Formatting helpers shared by the result card and the detail page.
 *
 * Kept out of VehicleCard.tsx so that file exports only components —
 * mixing non-component exports into it breaks react-refresh's fast-refresh
 * boundary (eslint-plugin-react-refresh flags exactly this).
 */

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
