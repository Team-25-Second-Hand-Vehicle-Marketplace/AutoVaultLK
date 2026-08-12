interface Props {
  label: string
  options: readonly string[]
  selected: string | undefined
  onChange: (value: string | undefined) => void
}

/**
 * Single-select variant of CheckboxFacetGroup, for spec filters the backend
 * only matches one exact value of (e.g. engine_class) — a checkbox list
 * would let a buyer visually "select" several while the query only ever
 * uses the last one, which reads as broken. Clicking the active option
 * again clears it back to "any".
 */
export function RadioFacetGroup({ label, options, selected, onChange }: Props) {
  return (
    <fieldset className="facet-group">
      <legend>{label}</legend>
      {options.map((option) => (
        <label key={option} className="facet-option">
          <input
            type="radio"
            name={label}
            checked={selected === option}
            onChange={() => onChange(selected === option ? undefined : option)}
          />
          {option}
        </label>
      ))}
    </fieldset>
  )
}
