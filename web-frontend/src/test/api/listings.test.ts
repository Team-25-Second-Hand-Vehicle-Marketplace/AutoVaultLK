import { describe, expect, it } from 'vitest'
import {
  CONDITIONS,
  FUEL_TYPES,
  LISTABLE_VEHICLE_TYPES,
  MANUAL_STATUSES,
  TRANSMISSION_TYPES,
} from '../../api/listings.types'

/**
 * These lists drive the manual listing form's selects, and each must match what
 * `CreateListingDto` validates against. A value offered here that the DTO
 * rejects produces a 400 with no field to attach it to — a failure the dealer
 * cannot act on.
 *
 * `listings-contract.test.ts` checks the same lists against the backend source
 * on disk; these are the plain-reading pins.
 */
describe('manual listing vocabularies', () => {
  it('offers all eleven vehicle types the database accepts', () => {
    // The last five were unreachable by hand until CreateListingDto was
    // fixed: migration 20000 extended vehicle_type without widening that DTO,
    // so a dealer could bulk-upload a lorry and not create one manually.
    expect([...LISTABLE_VEHICLE_TYPES]).toEqual([
      'CAR',
      'BIKE',
      'VAN',
      'TRUCK',
      'SUV',
      'BUS',
      'THREE_WHEELER',
      'LORRY',
      'PICKUP',
      'TRACTOR',
      'HEAVY_MACHINERY',
    ])
  })

  it('matches the accepted fuel types', () => {
    expect([...FUEL_TYPES]).toEqual(['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'CNG'])
  })

  it('matches the accepted transmissions', () => {
    expect([...TRANSMISSION_TYPES]).toEqual(['MANUAL', 'AUTOMATIC', 'CVT', 'SEMI_AUTOMATIC'])
  })

  it('matches the accepted conditions', () => {
    expect([...CONDITIONS]).toEqual(['NEW', 'USED', 'RECONDITIONED'])
  })

  it('offers only the statuses a dealer may set', () => {
    // ManualListingStatusDto. PENDING_REVIEW, SOLD, ARCHIVED and REJECTED are
    // the platform's to set, not the dealer's.
    expect([...MANUAL_STATUSES]).toEqual(['DRAFT', 'LIVE'])
  })
})
