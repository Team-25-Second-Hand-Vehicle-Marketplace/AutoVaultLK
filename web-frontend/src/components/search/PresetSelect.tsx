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
