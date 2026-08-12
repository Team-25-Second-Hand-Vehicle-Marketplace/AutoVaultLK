interface Option {
  label: string
  value: number | undefined
}

interface Props {
  label: string
  options: Option[]
  value: number | undefined
  onChange: (value: number | undefined) => void
}

/**
 * A single labeled dropdown mapping human presets ("Under 30,000 mi") to a
 * numeric filter value. Used for Max Mileage per the design ("Any mileage"
 * dropdown), as opposed to RangeInput's free-form min/max pair used for
 * Price and Year.
 */
export function PresetSelect({ label, options, value, onChange }: Props) {
  return (
    <fieldset className="preset-select">
      <legend>{label}</legend>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      >
        {options.map((opt) => (
          <option key={opt.label} value={opt.value ?? ''}>
            {opt.label}
          </option>
        ))}
      </select>
    </fieldset>
  )
}
