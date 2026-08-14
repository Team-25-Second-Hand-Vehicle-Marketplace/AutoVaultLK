import type { SortOption } from '../../api/search.types'

// Wording matches the design's dropdown ("Most Recent" etc.) rather than
// the more verbose internal labels used earlier.
const SORT_LABELS: Record<SortOption, string> = {
  relevance: 'Relevance',
  newest: 'Most Recent',
  price_asc: 'Price: Low to High',
  price_desc: 'Price: High to Low',
  year_desc: 'Newest Year',
  mileage_asc: 'Lowest Mileage',
}

export function SortDropdown({
  value,
  onChange,
}: {
  value: SortOption
  onChange: (value: SortOption) => void
}) {
  return (
    <select
      className="sort-dropdown"
      value={value}
      onChange={(e) => onChange(e.target.value as SortOption)}
    >
      {Object.entries(SORT_LABELS).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  )
}
