import type { FacetBucket } from '../../api/search.types'

interface Props {
  label: string
  options: readonly string[]
  facets?: FacetBucket[]
  selected: string[]
  onChange: (values: string[]) => void
}

export function CheckboxFacetGroup({ label, options, facets, selected, onChange }: Props) {
  const countFor = (value: string) => facets?.find((f) => f.value === value)?.count

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <fieldset className="facet-group">
      <legend>{label}</legend>
      {options.map((option) => {
        const count = countFor(option)
        // A facet count of 0 for an unselected option means "no results
        // would remain" — still shown, just visibly disabled, rather than
        // hidden. Hiding it would make the filter list jump around as the
        // buyer narrows their search, which is disorienting.
        const disabled = count === 0 && !selected.includes(option)
        return (
          <label key={option} className={disabled ? 'facet-option facet-option--empty' : 'facet-option'}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              disabled={disabled}
              onChange={() => toggle(option)}
            />
            {option}
            {count !== undefined && <span className="facet-count"> ({count})</span>}
          </label>
        )
      })}
    </fieldset>
  )
}
