import { describe, expect, it } from 'vitest'
import { buildRejectionsCsv, buildTemplateCsv } from '../../api/ingestion.api'
import {
  REQUIRED_COLUMNS,
  TEMPLATE_HEADER,
  isRequired,
} from '../../api/ingestion.template'
import { isTerminal, type RejectedRecord } from '../../api/ingestion.types'

describe('CSV template', () => {
  it('matches ingestion-service\'s TEMPLATE_HEADER exactly', () => {
    // Pinned. A template that drifts from the parser hands dealers a file that
    // fails validation, which is worse than offering no template at all.
    expect([...TEMPLATE_HEADER]).toEqual([
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
      'condition',
      'vehicle_type',
      'registration_number',
      'body_type',
      'location_city',
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
      'stroke_type',
      'cooling_system',
      'start_type',
      'abs_equipped',
      'seating_capacity',
      'roof_type',
      'wheelbase',
      'door_configuration',
      'payload_capacity_kg',
      'axle_count',
      'cargo_bed_type',
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
      'condition',
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

describe('buildRejectionsCsv', () => {
  const rejection = (overrides: Partial<RejectedRecord> = {}): RejectedRecord => ({
    rowNumber: 4,
    stage: 'VALIDATE_ROWS',
    reason: 'year is outside the accepted range',
    rawData: { make: 'Toyota', year: '1972' },
    rawDataTruncated: false,
    createdAt: '2026-09-01T10:03:00.000Z',
    ...overrides,
  })

  it('leads with row and reason, then the raw data columns', () => {
    const [header] = buildRejectionsCsv([rejection()]).trim().split('\n')

    expect(header).toBe('row,reason,make,year')
  })

  it('writes one data row per rejection', () => {
    const [, row] = buildRejectionsCsv([rejection()]).trim().split('\n')

    expect(row).toBe('4,year is outside the accepted range,Toyota,1972')
  })

  it('labels row 0 as the whole file, not row zero', () => {
    const [, row] = buildRejectionsCsv([rejection({ rowNumber: 0 })])
      .trim()
      .split('\n')

    expect(row.startsWith('whole file,')).toBe(true)
  })

  it('orders known columns to match the template, appending unknown ones after', () => {
    const rows = [
      rejection({ rawData: { color: 'White', make: 'Toyota', unknown_col: 'x' } }),
    ]

    const [header] = buildRejectionsCsv(rows).trim().split('\n')

    // make comes before color in TEMPLATE_HEADER; the unrecognised column
    // trails after every template column, alphabetically among any others.
    expect(header).toBe('row,reason,make,color,unknown_col')
  })

  it('unions columns across rows with different shapes', () => {
    const rows = [
      rejection({ rowNumber: 1, rawData: { make: 'Toyota' } }),
      rejection({ rowNumber: 2, rawData: { model: 'Vitz' } }),
    ]

    const [header] = buildRejectionsCsv(rows).trim().split('\n')

    expect(header).toBe('row,reason,make,model')
  })

  it('fills a missing value with an empty cell rather than shifting columns', () => {
    const rows = [
      rejection({ rowNumber: 1, rawData: { make: 'Toyota' } }),
      rejection({ rowNumber: 2, rawData: { model: 'Vitz' } }),
    ]

    const [, , secondRow] = buildRejectionsCsv(rows).trim().split('\n')

    expect(secondRow).toBe('2,year is outside the accepted range,,Vitz')
  })

  it('quotes a value containing a comma', () => {
    const rows = [rejection({ reason: 'price, mileage both missing' })]

    const [, row] = buildRejectionsCsv(rows).trim().split('\n')

    expect(row).toContain('"price, mileage both missing"')
  })

  it('escapes an embedded quote by doubling it', () => {
    const rows = [rejection({ rawData: { make: 'Toyota "Vitz" edition' } })]

    const [, row] = buildRejectionsCsv(rows).trim().split('\n')

    expect(row).toContain('"Toyota ""Vitz"" edition"')
  })

  it('returns just the header for an empty list', () => {
    expect(buildRejectionsCsv([]).trim()).toBe('row,reason')
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
