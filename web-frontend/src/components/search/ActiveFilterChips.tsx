import type { FilterSearchParams } from '../../api/search.types'

interface Props {
  appliedFilters: FilterSearchParams
  /**
   * Removes every listed key in ONE update. Range chips span two keys
   * (minPrice+maxPrice), and removing them with two single-key calls clears
   * only one half — both calls read the same pre-removal filter snapshot.
   */
  onRemove: (keys: string[]) => void
  onClearAll: () => void
}

// page/limit/facets/sort are control params, not user-facing filters — never
// shown as removable chips.
const HIDDEN_KEYS = new Set(['page', 'limit', 'facets', 'sort'])

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(n)
}

/**
 * Renders one applied filter as a readable chip, matching the design's
 * "SUV ×", "Under £50,000 ×" style rather than a raw "key: value" dump.
 * Range pairs (min/max price, min/max year, etc.) collapse into one chip
 * each instead of two, and removing either half of a pair clears both.
 */
function describeFilter(key: string, value: unknown): { label: string; removeKeys: string[] } | null {
  switch (key) {
    case 'minPrice':
    case 'maxPrice':
      return null // handled together, see priceRange below
    case 'minYear':
    case 'maxYear':
      return null // handled together, see yearRange below
    case 'vehicleType':
    case 'make':
    case 'model':
    case 'condition':
    case 'fuelType':
    case 'transmissionType':
    case 'color':
    case 'locationCity':
    case 'locationDistrict': {
      const values = Array.isArray(value) ? value : [value]
      return { label: values.join(', '), removeKeys: [key] }
    }
    case 'maxMileage':
      return { label: `Under ${formatCurrency(value as number)} km`, removeKeys: [key] }
    case 'maxOwners':
      return { label: `${value} owners max`, removeKeys: [key] }
    case 'isNegotiable':
      return { label: 'Negotiable', removeKeys: [key] }
    case 'hasRegistrationYear':
      return { label: 'Confirmed registration year', removeKeys: [key] }
    case 'verifiedDealersOnly':
      return { label: 'Verified dealers only', removeKeys: [key] }
    case 'q':
      return { label: `"${value}"`, removeKeys: [key] }
    case 'specs': {
      const specs = value as { key: string; value: string }[]
      return { label: specs.map((s) => s.value).join(', '), removeKeys: [key] }
    }
    default:
      return { label: `${key}: ${String(value)}`, removeKeys: [key] }
  }
}

export function ActiveFilterChips({ appliedFilters, onRemove, onClearAll }: Props) {
  const chips: { key: string; label: string; removeKeys: string[] }[] = []

  if (appliedFilters.minPrice !== undefined || appliedFilters.maxPrice !== undefined) {
    const min = appliedFilters.minPrice as number | undefined
    const max = appliedFilters.maxPrice as number | undefined
    const label =
      min !== undefined && max !== undefined
        ? `LKR ${formatCurrency(min)} – ${formatCurrency(max)}`
        : max !== undefined
          ? `Under LKR ${formatCurrency(max)}`
          : `Over LKR ${formatCurrency(min!)}`
    chips.push({ key: 'priceRange', label, removeKeys: ['minPrice', 'maxPrice'] })
  }

  if (appliedFilters.minYear !== undefined || appliedFilters.maxYear !== undefined) {
    const min = appliedFilters.minYear as number | undefined
    const max = appliedFilters.maxYear as number | undefined
    // A bare "2015" doesn't say whether it's a floor or a ceiling — spell it
    // out for the one-sided cases.
    const label =
      min !== undefined && max !== undefined
        ? `${min} – ${max}`
        : max !== undefined
          ? `Up to ${max}`
          : `From ${min}`
    chips.push({ key: 'yearRange', label, removeKeys: ['minYear', 'maxYear'] })
  }

  for (const [key, value] of Object.entries(appliedFilters)) {
    if (HIDDEN_KEYS.has(key) || value === undefined) continue
    const described = describeFilter(key, value)
    if (described) chips.push({ key, ...described })
  }

  if (chips.length === 0) return null

  return (
    <div className="active-filters">
      <span className="active-filters__label">Active filters:</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          className="filter-chip"
          // One call with every key this chip owns — see Props.onRemove.
          onClick={() => onRemove(chip.removeKeys)}
          aria-label={`Remove filter: ${chip.label}`}
        >
          {chip.label} ×
        </button>
      ))}
      <button className="filter-chip filter-chip--clear" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  )
}
