import { useEffect, useState } from 'react'
import { CheckboxFacetGroup } from './CheckboxFacetGroup'
import { RadioFacetGroup } from './RadioFacetGroup'
import { RangeInput } from './RangeInput'
import { PresetSelect } from './PresetSelect'
import { MakeModelSelect } from './MakeModelSelect'
import { getSearchOptions } from '../../api/search.api'
import { Button } from '../ui/Button'
import type {
  FilterSearchParams,
  Facets,
  SearchOptionsResponse,
  VehicleTypeValue,
} from '../../api/search.types'

const FALLBACK_VEHICLE_TYPES: VehicleTypeValue[] = [
  'CAR', 'BIKE', 'VAN', 'TRUCK', 'SUV', 'BUS',
  'THREE_WHEELER', 'LORRY', 'PICKUP', 'TRACTOR', 'HEAVY_MACHINERY',
]
const FALLBACK_FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG']
const FALLBACK_TRANSMISSION_TYPES = ['MANUAL', 'AUTOMATIC', 'CVT', 'SEMI_AUTOMATIC']
const FALLBACK_CONDITIONS = ['NEW', 'USED', 'RECONDITIONED']
const FALLBACK_BODY_TYPES = [
  'SEDAN', 'HATCHBACK', 'SUV', 'WAGON', 'COUPE',
  'CONVERTIBLE', 'PICKUP', 'MINIVAN', 'SCOOTER', 'MOTORBIKE',
]

const MILEAGE_PRESETS = [
  { label: 'Any mileage', value: undefined },
  { label: 'Under 10,000 km', value: 10000 },
  { label: 'Under 30,000 km', value: 30000 },
  { label: 'Under 60,000 km', value: 60000 },
  { label: 'Under 100,000 km', value: 100000 },
  { label: 'Under 150,000 km', value: 150000 },
]

const OWNERS_PRESETS = [
  { label: 'Any number of owners', value: undefined },
  { label: 'First owner only', value: 1 },
  { label: 'Up to 2 owners', value: 2 },
  { label: 'Up to 3 owners', value: 3 },
]

const ENGINE_CLASSES = ['100cc', '125cc', '150cc', '155cc', '160cc', '200cc', '250cc+']

const DRIVE_TYPES = ['FWD', 'RWD', 'AWD', '4WD']

const LOAD_CAPACITY_PRESETS = [
  { label: 'Any load capacity', value: undefined },
  { label: '1,000 kg', value: 1000 },
  { label: '3,000 kg', value: 3000 },
  { label: '5,000 kg', value: 5000 },
  { label: '8,000 kg', value: 8000 },
]

const SEATS_PRESETS = [
  { label: 'Any number of seats', value: undefined },
  { label: '2 seats', value: 2 },
  { label: '4 seats', value: 4 },
  { label: '5 seats', value: 5 },
  { label: '7 seats', value: 7 },
  { label: '8 seats', value: 8 },
]

interface Props {
  filters: FilterSearchParams
  facets?: Facets
  onUpdate: <K extends keyof FilterSearchParams>(key: K, value: FilterSearchParams[K]) => void
  onUpdateMany: (patch: Partial<FilterSearchParams>) => void
  onApply: () => void
  onReset: () => void
  hasUnappliedChanges: boolean
}

export function FilterSidebar({
  filters,
  facets,
  onUpdate,
  onUpdateMany,
  onApply,
  onReset,
  hasUnappliedChanges,
}: Props) {
  const [options, setOptions] = useState<SearchOptionsResponse | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getSearchOptions(undefined, controller.signal)
      .then(setOptions)
      .catch(() => {
      })
    return () => controller.abort()
  }, [])

  const setSpecFilters = (values: string[], key: string) => {
    const withoutKey = (filters.specs ?? []).filter((s) => s.key !== key)
    const next = [...withoutKey, ...values.map((value) => ({ key, value }))]
    onUpdate('specs', next.length > 0 ? next : undefined)
  }

  const getSpec = (key: string): string | undefined =>
    (filters.specs ?? []).find((s) => s.key === key)?.value

  const setSpec = (key: string, value: string | undefined) => {
    const withoutKey = (filters.specs ?? []).filter((s) => s.key !== key)
    const next = value === undefined ? withoutKey : [...withoutKey, { key, value }]
    onUpdate('specs', next.length > 0 ? next : undefined)
  }

  const selectedTypes = filters.vehicleType ?? []
  const showEngineClass = selectedTypes.length === 0 || selectedTypes.includes('BIKE')
  const showLoadCapacity =
    selectedTypes.length === 0 || selectedTypes.some((t) => t === 'LORRY' || t === 'TRUCK')
  const showPassengerSpecs =
    selectedTypes.length === 0 ||
    selectedTypes.some((t) => ['CAR', 'SUV', 'VAN', 'BUS', 'PICKUP'].includes(t))

  return (
    <aside className="filter-sidebar" aria-label="Filter results">
      <div className="filter-sidebar__header">
        <h2>Filter Results</h2>
        <button type="button" className="link-button" onClick={onReset}>
          Reset
        </button>
      </div>

      <CheckboxFacetGroup
        label="Vehicle Type"
        options={options?.vehicleTypes ?? FALLBACK_VEHICLE_TYPES}
        facets={facets?.vehicleType}
        selected={filters.vehicleType ?? []}
        onChange={(v) => onUpdate('vehicleType', (v.length ? v : undefined) as VehicleTypeValue[])}
      />

      <MakeModelSelect
        vehicleTypes={filters.vehicleType ?? []}
        selectedMakes={filters.make ?? []}
        selectedModels={filters.model ?? []}
        onMakesChange={(v) => onUpdate('make', v.length ? v : undefined)}
        onModelsChange={(v) => onUpdate('model', v.length ? v : undefined)}
      />

      <RangeInput
        label="Price (LKR)"
        min={filters.minPrice}
        max={filters.maxPrice}
        step={50000}
        onChange={(min, max) => onUpdateMany({ minPrice: min, maxPrice: max })}
      />

      <RangeInput
        label="Year"
        min={filters.minYear}
        max={filters.maxYear}
        onChange={(min, max) => onUpdateMany({ minYear: min, maxYear: max })}
      />

      <CheckboxFacetGroup
        label="Condition"
        options={options?.conditions ?? FALLBACK_CONDITIONS}
        facets={facets?.condition}
        selected={filters.condition ?? []}
        onChange={(v) => onUpdate('condition', v.length ? v : undefined)}
      />

      <PresetSelect
        label="Max Mileage"
        options={MILEAGE_PRESETS}
        value={filters.maxMileage}
        onChange={(value) => onUpdate('maxMileage', value)}
      />

      <CheckboxFacetGroup
        label="Fuel Type"
        options={options?.fuelTypes ?? FALLBACK_FUEL_TYPES}
        facets={facets?.fuelType}
        selected={filters.fuelType ?? []}
        onChange={(v) => onUpdate('fuelType', v.length ? v : undefined)}
      />

      <CheckboxFacetGroup
        label="Transmission"
        options={options?.transmissionTypes ?? FALLBACK_TRANSMISSION_TYPES}
        facets={facets?.transmissionType}
        selected={filters.transmissionType ?? []}
        onChange={(v) => onUpdate('transmissionType', v.length ? v : undefined)}
      />

      {options?.districts && options.districts.length > 0 && (
        <CheckboxFacetGroup
          label="District"
          options={options.districts}
          selected={filters.locationDistrict ?? []}
          onChange={(v) => onUpdate('locationDistrict', v.length ? v : undefined)}
        />
      )}

      <CheckboxFacetGroup
        label="Body Type"
        options={options?.bodyTypes ?? FALLBACK_BODY_TYPES}
        selected={(filters.specs ?? []).filter((s) => s.key === 'body_type').map((s) => s.value)}
        onChange={(values) => setSpecFilters(values, 'body_type')}
      />

      {showPassengerSpecs && (
        <>
          <PresetSelect
            label="Seats"
            options={SEATS_PRESETS}
            value={getSpec('seats') ? Number(getSpec('seats')) : undefined}
            onChange={(value) =>
              setSpec('seats', value === undefined ? undefined : String(value))
            }
          />

          <RadioFacetGroup
            label="Drive Type"
            options={DRIVE_TYPES}
            selected={getSpec('drive_type')}
            onChange={(value) => setSpec('drive_type', value)}
          />
        </>
      )}

      {showEngineClass && (
        <RadioFacetGroup
          label="Engine Class"
          options={ENGINE_CLASSES}
          selected={getSpec('engine_class')}
          onChange={(value) => setSpec('engine_class', value)}
        />
      )}

      {showLoadCapacity && (
        <PresetSelect
          label="Load Capacity"
          options={LOAD_CAPACITY_PRESETS}
          value={getSpec('load_capacity_kg') ? Number(getSpec('load_capacity_kg')) : undefined}
          onChange={(value) =>
            setSpec('load_capacity_kg', value === undefined ? undefined : String(value))
          }
        />
      )}

      <PresetSelect
        label="Previous Owners"
        options={OWNERS_PRESETS}
        value={filters.maxOwners}
        onChange={(value) => onUpdate('maxOwners', value)}
      />

      <div className="filter-sidebar__toggles">
        <label className="toggle-filter">
          <input
            type="checkbox"
            checked={filters.isNegotiable ?? false}
            onChange={(e) => onUpdate('isNegotiable', e.target.checked || undefined)}
          />
          Negotiable price only
        </label>

        <label className="toggle-filter">
          <input
            type="checkbox"
            checked={filters.verifiedDealersOnly ?? false}
            onChange={(e) => onUpdate('verifiedDealersOnly', e.target.checked || undefined)}
          />
          Verified dealers only
        </label>

        <label className="toggle-filter">
          <input
            type="checkbox"
            checked={filters.hasRegistrationYear ?? false}
            onChange={(e) => onUpdate('hasRegistrationYear', e.target.checked || undefined)}
          />
          <span title="Excludes listings where the dealer omitted the registration year">
            Confirmed registration year only
          </span>
        </label>

        <label className="toggle-filter">
          <input
            type="checkbox"
            checked={Boolean(getSpec('sunroof'))}
            onChange={(e) => setSpec('sunroof', e.target.checked ? 'true' : undefined)}
          />
          Sunroof
        </label>
      </div>

      <Button
        type="button"
        className="apply-filters-button"
        onClick={onApply}
        disabled={!hasUnappliedChanges}
      >
        {hasUnappliedChanges ? 'Apply Filters' : 'Filters Applied'}
      </Button>
    </aside>
  )
}
