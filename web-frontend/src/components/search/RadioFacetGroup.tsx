interface Props {
  label: string
  options: readonly string[]
  selected: string | undefined
  onChange: (value: string | undefined) => void
}

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
