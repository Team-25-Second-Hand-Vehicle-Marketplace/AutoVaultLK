import { useEffect, useMemo, useState } from 'react'
import { getSearchOptions } from '../../api/search.api'
import type { MakeOption, VehicleTypeValue } from '../../api/search.types'

interface Props {
  vehicleTypes: VehicleTypeValue[]
  selectedMakes: string[]
  selectedModels: string[]
  onMakesChange: (makes: string[]) => void
  onModelsChange: (models: string[]) => void
}

/**
 * Cascading make → model filter.
 *
 * The make list is scoped to the selected vehicle type where possible (the
 * dictionary's vehicle_types column is what makes "bikes exclude Toyota"
 * work). Models are only offered once at least one make is chosen —
 * a flat list of all 133 models across 30 makes is unusable, and model names
 * are not unique across makes.
 */
export function MakeModelSelect({
  vehicleTypes,
  selectedMakes,
  selectedModels,
  onMakesChange,
  onModelsChange,
}: Props) {
  const [makes, setMakes] = useState<MakeOption[]>([])
  const [error, setError] = useState(false)

  // Backend scopes options by a single vehicleType; with several selected we
  // fall back to the unscoped list rather than guessing an intersection.
  const scopeType = vehicleTypes.length === 1 ? vehicleTypes[0] : undefined

  useEffect(() => {
    const controller = new AbortController()
    setError(false)

    getSearchOptions(scopeType, controller.signal)
      .then((res) => setMakes(res.makes))
      .catch((err) => {
        // An abort is this effect superseding itself, not a failure.
        if (controller.signal.aborted) return
        // Previously this had no catch at all, so a failed request became an
        // unhandled rejection and the Make list silently stayed empty with no
        // indication anything had gone wrong.
        console.error('Failed to load makes:', err)
        setError(true)
      })

    return () => controller.abort()
  }, [scopeType])

  /**
   * Models available for the chosen makes.
   *
   * Tagged with their make so the UI can disambiguate — two makes can both
   * have a "Civic"-like name collision, and the backend filters models by
   * name alone.
   */
  const availableModels = useMemo(() => {
    if (selectedMakes.length === 0) return []
    return makes
      .filter((make) => selectedMakes.includes(make.name))
      .flatMap((make) => make.models.map((model) => ({ ...model, makeName: make.name })))
  }, [makes, selectedMakes])

  const toggleMake = (name: string) => {
    if (selectedMakes.includes(name)) {
      const nextMakes = selectedMakes.filter((m) => m !== name)
      onMakesChange(nextMakes)

      // Drop any selected model that belonged to the make just removed —
      // leaving it applied would filter on a model whose make is no longer
      // selected, which reliably produces zero results.
      const stillValid = makes
        .filter((make) => nextMakes.includes(make.name))
        .flatMap((make) => make.models.map((model) => model.name))
      const nextModels = selectedModels.filter((model) => stillValid.includes(model))
      if (nextModels.length !== selectedModels.length) {
        onModelsChange(nextModels)
      }
    } else {
      onMakesChange([...selectedMakes, name])
    }
  }

  const toggleModel = (name: string) => {
    onModelsChange(
      selectedModels.includes(name)
        ? selectedModels.filter((m) => m !== name)
        : [...selectedModels, name],
    )
  }

  return (
    <>
      <fieldset className="facet-group make-select">
        <legend>Make</legend>
        {error && <p className="facet-group__note">Couldn't load makes. Try reloading.</p>}
        {!error && makes.length === 0 && <p className="facet-group__note">Loading makes…</p>}
        <div className="facet-group__list make-select__list">
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
          <div className="facet-group__list make-select__list">
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
