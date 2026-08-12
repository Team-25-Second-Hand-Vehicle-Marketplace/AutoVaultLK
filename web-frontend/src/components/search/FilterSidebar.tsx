import { CheckboxFacetGroup } from './CheckboxFacetGroup'
import { RadioFacetGroup } from './RadioFacetGroup'
import { RangeInput } from './RangeInput'
import { PresetSelect } from './PresetSelect'
import { MakeModelSelect } from './MakeModelSelect'
import type { FilterSearchParams, Facets, VehicleTypeValue } from '../../api/search.types'

const VEHICLE_TYPES: VehicleTypeValue[] = [
  'CAR', 'BIKE', 'VAN', 'TRUCK', 'SUV', 'BUS',
  'THREE_WHEELER', 'LORRY', 'PICKUP', 'TRACTOR', 'HEAVY_MACHINERY',
]
const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG']
const TRANSMISSION_TYPES = ['MANUAL', 'AUTOMATIC', 'CVT', 'SEMI_AUTOMATIC']

// Matches KNOWN_SPEC_KEYS.body_type.values (marketplace-service constants) —
// keep in sync by hand until the frontend generates this from /search/options.
const BODY_TYPES = [
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

// Matches KNOWN_SPEC_KEYS.engine_class.values (marketplace-service).
// Only meaningful for bikes — hidden unless BIKE is the only selected type.
const ENGINE_CLASSES = ['100cc', '125cc', '150cc', '155cc', '160cc', '200cc', '250cc+']

// Backend spec filters are equality-only ((specs->>'key')::int = $n), not a
// range — so load_capacity_kg is a preset dropdown of exact tonnages a
// lorry/truck buyer would search for, same pattern as Max Mileage, rather
// than a min/max slider the backend can't actually satisfy.
const LOAD_CAPACITY_PRESETS = [
  { label: 'Any load capacity', value: undefined },
  { label: '1,000 kg', value: 1000 },
  { label: '3,000 kg', value: 3000 },
  { label: '5,000 kg', value: 5000 },
  { label: '8,000 kg', value: 8000 },
]

interface Props {
  filters: FilterSearchParams
  facets?: Facets
  onUpdate: <K extends keyof FilterSearchParams>(key: K, value: FilterSearchParams[K]) => void
  // Range inputs set a min and a max together. Two onUpdate calls in a row
  // would clobber each other — both close over the same filters snapshot.
  onUpdateMany: (patch: Partial<FilterSearchParams>) => void
  onApply: () => void
  onReset: () => void
  hasUnappliedChanges: boolean
}

/**
 * All inputs here bind to the caller's DRAFT filter state (see
 * useVehicleSearch — `draft` + `updateDraft`/`updateDraftMany`), not the
 * applied filters. Nothing here triggers a search on its own; onApply does.
 * Matches the design's "Filter Results … Apply Filters" sidebar.
 */
export function FilterSidebar({
  filters,
  facets,
  onUpdate,
  onUpdateMany,
  onApply,
  onReset,
  hasUnappliedChanges,
}: Props) {
  const setSpecFilters = (values: string[], key: string) => {
    const withoutKey = (filters.specs ?? []).filter((s) => s.key !== key)
    const next = [...withoutKey, ...values.map((value) => ({ key, value }))]
    onUpdate('specs', next)
  }

  // Single-value spec fields (engine_class, load_capacity_kg): each key can
  // hold at most one active spec[] entry, unlike body_type's multi-select.
  const getSpec = (key: string): string | undefined =>
    (filters.specs ?? []).find((s) => s.key === key)?.value

  const setSpec = (key: string, value: string | undefined) => {
    const withoutKey = (filters.specs ?? []).filter((s) => s.key !== key)
    onUpdate('specs', value === undefined ? withoutKey : [...withoutKey, { key, value }])
  }

  const selectedTypes = filters.vehicleType ?? []
  const showEngineClass = selectedTypes.length === 0 || selectedTypes.includes('BIKE')
  const showLoadCapacity =
    selectedTypes.length === 0 ||
    selectedTypes.some((t) => t === 'LORRY' || t === 'TRUCK')

  return (
    <aside className="filter-sidebar">
      <div className="filter-sidebar__header">
        <h2>Filter Results</h2>
        <button type="button" className="link-button" onClick={onReset}>
          Reset
        </button>
      </div>

      <CheckboxFacetGroup
        label="Vehicle Type"
        options={VEHICLE_TYPES}
        facets={facets?.vehicleType}
        selected={filters.vehicleType ?? []}
        onChange={(v) => onUpdate('vehicleType', v as VehicleTypeValue[])}
      />

      <MakeModelSelect
        vehicleTypes={filters.vehicleType ?? []}
        selectedMakes={filters.make ?? []}
        onChange={(v) => onUpdate('make', v)}
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

      <PresetSelect
        label="Max Mileage"
        options={MILEAGE_PRESETS}
        value={filters.maxMileage}
        onChange={(value) => onUpdate('maxMileage', value)}
      />

      <CheckboxFacetGroup
        label="Fuel Type"
        options={FUEL_TYPES}
        facets={facets?.fuelType}
        selected={filters.fuelType ?? []}
        onChange={(v) => onUpdate('fuelType', v as any)}
      />

      <CheckboxFacetGroup
        label="Transmission"
        options={TRANSMISSION_TYPES}
        facets={facets?.transmissionType}
        selected={filters.transmissionType ?? []}
        onChange={(v) => onUpdate('transmissionType', v as any)}
      />

      {/*
        Body type lives in specs JSONB, not a vehicles column (Decision D1),
        so it goes through the specs[] filter shape rather than onUpdate on a
        top-level DTO field. Only one body_type value is kept active at a
        time per the backend's equality-on-@> semantics, but the control
        supports selecting several — each becomes its own specs[] entry.
      */}
      <CheckboxFacetGroup
        label="Body Type"
        options={BODY_TYPES}
        selected={(filters.specs ?? []).filter((s) => s.key === 'body_type').map((s) => s.value)}
        onChange={(values) => setSpecFilters(values, 'body_type')}
      />

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
          onChange={(value) => setSpec('load_capacity_kg', value === undefined ? undefined : String(value))}
        />
      )}

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
        <span title="Excludes listings where the dealer omitted registration year">
          Confirmed registration year only
        </span>
      </label>

      <button
        type="button"
        className="apply-filters-button"
        onClick={onApply}
        disabled={!hasUnappliedChanges}
      >
        Apply Filters
      </button>
    </aside>
  )
}
