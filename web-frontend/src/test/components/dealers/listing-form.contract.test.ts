import { describe, expect, it } from 'vitest'
import { TEMPLATE_HEADER } from '../../../api/ingestion.template'
import {
  CSV_COLUMN_TO_FIELD,
  MANAGED_SPEC_KEYS,
  buildSpecs,
} from '../../../components/dealers/listing-form.specs'

/**
 * The manual listing form and the bulk-upload CSV describe the same listing.
 * If they drift, a dealer who enters a vehicle by hand gets a thinner record
 * than one who uploads it, and neither path knows. These fail the build when a
 * column is added to the template without a field to carry it.
 */
describe('manual listing form vs. dealer CSV template', () => {
  it('has a form field for every one of the 43 template columns', () => {
    expect(TEMPLATE_HEADER).toHaveLength(43)
    expect(Object.keys(CSV_COLUMN_TO_FIELD).sort()).toEqual([...TEMPLATE_HEADER].sort())
  })

  it('maps no two columns onto the same field', () => {
    const fields = Object.values(CSV_COLUMN_TO_FIELD)
    expect(new Set(fields).size).toBe(fields.length)
  })

  it('stores every spec column the CSV pipeline stores, under the same key', () => {
    // Columns the enrich stage writes into `specs` (not into a vehicle column).
    const specColumns = [
      'body_type', 'seats', 'doors', 'airbags', 'load_capacity_kg', 'drive_type',
      'sunroof', 'full_option', 'alloy_wheels', 'reverse_camera', 'leather_seats',
      'power_steering', 'air_conditioning', 'stroke_type', 'cooling_system',
      'start_type', 'abs_equipped', 'seating_capacity', 'roof_type', 'wheelbase',
      'door_configuration', 'payload_capacity_kg', 'axle_count', 'cargo_bed_type',
    ]
    for (const column of specColumns) expect(MANAGED_SPEC_KEYS.has(column)).toBe(true)
  })
})

describe('buildSpecs', () => {
  it('gates category columns by vehicle type, like the ETL', () => {
    const everything = {
      bodyType: 'SUV', seats: 5, strokeType: '4_STROKE', roofType: 'HIGH_ROOF',
      axleCount: 3, sunroof: true,
    }
    expect(buildSpecs({ ...everything, vehicleType: 'CAR' })).toEqual({
      body_type: 'SUV', seats: 5, sunroof: true,
    })
    expect(buildSpecs({ ...everything, vehicleType: 'BIKE' })).toEqual({
      body_type: 'SUV', stroke_type: '4_STROKE', sunroof: true,
    })
    expect(buildSpecs({ ...everything, vehicleType: 'VAN' })).toEqual({
      body_type: 'SUV', roof_type: 'HIGH_ROOF', sunroof: true,
    })
    expect(buildSpecs({ ...everything, vehicleType: 'LORRY' })).toEqual({
      body_type: 'SUV', axle_count: 3, sunroof: true,
    })
  })

  it('treats a blank vehicle type as CAR', () => {
    expect(buildSpecs({ seats: 4, strokeType: '2_STROKE' })).toEqual({ seats: 4 })
  })

  it('omits unticked flags and blanks instead of storing false / empty', () => {
    expect(buildSpecs({ sunroof: false, driveType: '', airbags: 0 })).toEqual({ airbags: 0 })
  })

  it('keeps spec keys the form does not own', () => {
    expect(buildSpecs({ seats: 5 }, { warranty: '2 years', seats: 99 })).toEqual({
      warranty: '2 years',
      seats: 5,
    })
  })
})
