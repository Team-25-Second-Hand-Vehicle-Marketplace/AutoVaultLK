import { humanizeEnum } from './vehicle-format'

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
            onChange={() => onChange(option)}
            // A browser never fires `change` when an already-selected radio is
            // clicked, so deselecting has to be handled on click instead.
            onClick={() => {
              if (selected === option) onChange(undefined)
            }}
          />
          {humanizeEnum(option)}
        </label>
      ))}
    </fieldset>
  )
}
