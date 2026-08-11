interface Props {
  appliedFilters: Record<string, unknown>
  onRemove: (key: string) => void
  onClearAll: () => void
}

// page/limit/facets are control params, not user-facing filters — never
// shown as removable chips.
const HIDDEN_KEYS = new Set(['page', 'limit', 'facets', 'sort'])

export function ActiveFilterChips({ appliedFilters, onRemove, onClearAll }: Props) {
  const entries = Object.entries(appliedFilters).filter(([key]) => !HIDDEN_KEYS.has(key))
  if (entries.length === 0) return null

  return (
    <div className="active-filters">
      {entries.map(([key, value]) => (
        <button key={key} className="filter-chip" onClick={() => onRemove(key)}>
          {key}: {String(value)} ×
        </button>
      ))}
      <button className="filter-chip filter-chip--clear" onClick={onClearAll}>
        Clear all
      </button>
    </div>
  )
}
