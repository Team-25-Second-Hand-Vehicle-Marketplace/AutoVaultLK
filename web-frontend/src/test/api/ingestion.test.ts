import { describe, expect, it } from 'vitest'
import { buildTemplateCsv } from '../../api/ingestion.api'
import {
  REQUIRED_COLUMNS,
  TEMPLATE_HEADER,
  isRequired,
} from '../../api/ingestion.template'
import { isTerminal } from '../../api/ingestion.types'

describe('CSV template', () => {
  it('matches ingestion-service\'s TEMPLATE_HEADER exactly', () => {
    // Pinned. A template that drifts from the parser hands dealers a file that
    // fails validation, which is worse than offering no template at all.
    expect([...TEMPLATE_HEADER]).toEqual([
      'vehicle_type',
      'make',
      'model',
      'year',
      'price',
      'mileage',
      'registration_number',
      'fuel_type',
      'transmission',
      'body_type',
      'condition',
      'engine_capacity_cc',
      'color',
      'owners_count',
      'location_city',
      'location_district',
      'chassis_number',
      'description',
      'is_negotiable',
      'registration_year',
      'seats',
      'doors',
      'airbags',
      'load_capacity_kg',
      'drive_type',
      'sunroof',
      'full_option',
      'alloy_wheels',
      'reverse_camera',
      'leather_seats',
      'power_steering',
      'air_conditioning',
    ])
  })

  it('marks exactly the columns validateFile insists on', () => {
    expect([...REQUIRED_COLUMNS]).toEqual([
      'make',
      'model',
      'year',
      'price',
      'mileage',
      'fuel_type',
      'transmission',
      'color',
      'engine_capacity_cc',
      'owners_count',
      'location_district',
    ])
    expect(isRequired('make')).toBe(true)
    expect(isRequired('fuel_type')).toBe(true)
    // Blank is legitimate — unregistered imports have no plate.
    expect(isRequired('registration_number')).toBe(false)
  })

  it('builds a downloadable CSV whose header matches the contract', () => {
    const [header, example] = buildTemplateCsv().trim().split('\n')

    expect(header).toBe(TEMPLATE_HEADER.join(','))
    // The example row must have one cell per column, or a dealer editing it
    // shifts every value into the wrong field.
    expect(example.split(',')).toHaveLength(TEMPLATE_HEADER.length)
  })
})

describe('isTerminal', () => {
  it('treats PARTIAL as terminal', () => {
    // PARTIAL means some rows were rejected and the rest loaded — the job is
    // finished. Polling on would be pure noise against the gateway.
    expect(isTerminal('PARTIAL')).toBe(true)
  })

  it.each(['COMPLETED', 'FAILED'] as const)('treats %s as terminal', (status) => {
    expect(isTerminal(status)).toBe(true)
  })

  it.each(['PENDING', 'PROCESSING'] as const)('keeps polling on %s', (status) => {
    expect(isTerminal(status)).toBe(false)
  })
})
