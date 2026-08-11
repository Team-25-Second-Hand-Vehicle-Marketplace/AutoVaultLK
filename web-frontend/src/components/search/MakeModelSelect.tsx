import { useEffect, useState } from 'react'
import { getSearchOptions } from '../../api/search.api'
import type { MakeOption, VehicleTypeValue } from '../../api/search.types'

interface Props {
  vehicleTypes: VehicleTypeValue[]
  selectedMakes: string[]
  onChange: (makes: string[]) => void
}

export function MakeModelSelect({ vehicleTypes, selectedMakes, onChange }: Props) {
  const [makes, setMakes] = useState<MakeOption[]>([])

  useEffect(() => {
    // Backend only accepts a single vehicleType for scoping (§4.7's
    // getOptions signature) — with multiple types selected we fall back to
    // the unscoped list rather than guessing an intersection.
    const scopeType = vehicleTypes.length === 1 ? vehicleTypes[0] : undefined
    getSearchOptions(scopeType).then((res) => setMakes(res.makes))
  }, [vehicleTypes.join(',')])

  const toggle = (name: string) => {
    if (selectedMakes.includes(name)) {
      onChange(selectedMakes.filter((m) => m !== name))
    } else {
      onChange([...selectedMakes, name])
    }
  }

  return (
    <fieldset className="make-select">
      <legend>Make</legend>
      <div className="make-select__list">
        {makes.map((make) => (
          <label key={make.id} className="facet-option">
            <input
              type="checkbox"
              checked={selectedMakes.includes(make.name)}
              onChange={() => toggle(make.name)}
            />
            {make.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
