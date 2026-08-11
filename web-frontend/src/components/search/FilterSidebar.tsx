import { CheckboxFacetGroup } from './CheckboxFacetGroup'
import { RangeInput } from './RangeInput'
import { MakeModelSelect } from './MakeModelSelect'
import type { FilterSearchParams, Facets, VehicleTypeValue } from '../../api/search.types'

const VEHICLE_TYPES: VehicleTypeValue[] = [
  'CAR', 'BIKE', 'VAN', 'TRUCK', 'SUV', 'BUS',
  'THREE_WHEELER', 'LORRY', 'PICKUP', 'TRACTOR', 'HEAVY_MACHINERY',
]
const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG']
const TRANSMISSION_TYPES = ['MANUAL', 'AUTOMATIC', 'CVT', 'SEMI_AUTOMATIC']

interface Props {
  filters: FilterSearchParams
  facets?: Facets
  onUpdate: <K extends keyof FilterSearchParams>(key: K, value: FilterSearchParams[K]) => void
  // Range inputs set a min and a max together. Two onUpdate calls in a row
  // would clobber each other — both close over the same `filters` snapshot.
  onUpdateMany: (patch: Partial<FilterSearchParams>) => void
}

export function FilterSidebar({ filters, facets, onUpdate, onUpdateMany }: Props) {
  return (
    <aside className="filter-sidebar">
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

      <RangeInput
        label="Mileage (km)"
        min={filters.minMileage}
        max={filters.maxMileage}
        step={5000}
        onChange={(min, max) => onUpdateMany({ minMileage: min, maxMileage: max })}
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
    </aside>
  )
}
