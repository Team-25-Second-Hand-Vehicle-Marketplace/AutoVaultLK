import { useEffect, useMemo, useState } from 'react'
import { getSearchOptions } from '../../api/search.api'
import type { FilterSearchParams, MakeOption, VehicleTypeValue } from '../../api/search.types'

interface Props {
  vehicleTypes: VehicleTypeValue[]
  selectedMakes: string[]
  selectedModels: string[]
  onChange: (patch: Pick<FilterSearchParams, 'make' | 'model'>) => void
}

export function MakeModelSelect({
  vehicleTypes,
  selectedMakes,
  selectedModels,
  onChange,
}: Props) {
  
  const scopeType = vehicleTypes.length === 1 ? vehicleTypes[0] : undefined


  const [state, setState] = useState<{ makes: MakeOption[]; error: boolean }>({
    makes: [],
    error: false,
  })
  const { makes, error } = state

  useEffect(() => {
    const controller = new AbortController()

    getSearchOptions(scopeType, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setState({ makes: res.makes, error: false })
      })
      .catch((err) => {
        // An abort is this effect superseding itself, not a failure.
        if (controller.signal.aborted) return
      
        console.error('Failed to load makes:', err)
        setState({ makes: [], error: true })
      })

    return () => controller.abort()
  }, [scopeType])

  
  const availableModels = useMemo(() => {
    if (selectedMakes.length === 0) return []
    return makes
      .filter((make) => selectedMakes.includes(make.name))
      .flatMap((make) => make.models.map((model) => ({ ...model, makeName: make.name })))
  }, [makes, selectedMakes])

  const toggleMake = (name: string) => {
    if (selectedMakes.includes(name)) {
      const nextMakes = selectedMakes.filter((m) => m !== name)
      const stillValid = makes
        .filter((make) => nextMakes.includes(make.name))
        .flatMap((make) => make.models.map((model) => model.name))
      const nextModels = selectedModels.filter((model) => stillValid.includes(model))
      // A make removal can invalidate models. Send both fields together so it
      // remains one filter update and therefore one search request.
      onChange({ make: nextMakes, model: nextModels })
    } else {
      onChange({ make: [...selectedMakes, name] })
    }
  }

  const toggleModel = (name: string) => {
    onChange({
      model: selectedModels.includes(name)
        ? selectedModels.filter((m) => m !== name)
        : [...selectedModels, name],
    })
  }

  return (
    <>
      <fieldset className="facet-group make-select">
        <legend>Make</legend>
        {error && <p className="facet-group__note">Couldn't load makes. Try reloading.</p>}
        {!error && makes.length === 0 && <p className="facet-group__note">Loading makes…</p>}
        <div className="facet-group__list make-select__list" data-lenis-prevent>
          {makes.map((make) => (
            <label key={make.id} className="facet-option">
              <input
                type="checkbox"
                checked={selectedMakes.includes(make.name)}
                onChange={() => toggleMake(make.name)}
              />
              <span>{make.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {availableModels.length > 0 && (
        <fieldset className="facet-group make-select">
          <legend>Model</legend>
          <div className="facet-group__list make-select__list" data-lenis-prevent>
            {availableModels.map((model) => (
              <label key={model.id} className="facet-option">
                <input
                  type="checkbox"
                  checked={selectedModels.includes(model.name)}
                  onChange={() => toggleModel(model.name)}
                />
                <span>
                  {model.name}
                  {/* Only worth showing when several makes are in play. */}
                  {selectedMakes.length > 1 && (
                    <span className="facet-option__hint"> · {model.makeName}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  )
}
