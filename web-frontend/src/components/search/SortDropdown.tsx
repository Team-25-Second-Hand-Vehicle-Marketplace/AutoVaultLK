import type { SortOption } from '../../api/search.types'

const SORT_LABELS: Record<SortOption, string> = {
  relevance: 'Relevance',
  price_asc: 'Price: Low to High',
  price_desc: 'Price: High to Low',
  year_desc: 'Year: Newest First',
  mileage_asc: 'Mileage: Lowest First',
  newest: 'Recently Listed',
}

export function SortDropdown({
  value,
  onChange,
}: {
  value: SortOption
  onChange: (value: SortOption) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as SortOption)}>
      {Object.entries(SORT_LABELS).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  )
}
