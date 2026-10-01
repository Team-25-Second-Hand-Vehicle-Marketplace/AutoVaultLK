import { describe, expect, it } from 'vitest'
import type { DealerListing } from '../../../api/listings.types'
import {
  firstDirection,
  nextColumnSort,
  sortListings,
} from '../../../components/dealers/listing-sort'

const make = (id: string, overrides: Partial<DealerListing>): DealerListing =>
  ({
    id,
    make: 'Toyota',
    model: 'Aqua',
    manufactureYear: 2018,
    price: 1,
    mileage: 1,
    status: 'LIVE',
    vehicleType: 'CAR',
    condition: 'USED',
    ...overrides,
  }) as DealerListing

const ids = (rows: DealerListing[]) => rows.map((r) => r.id)

describe('nextColumnSort', () => {
  it('starts numbers highest first and text A to Z', () => {
    expect(firstDirection('price')).toBe('desc')
    expect(firstDirection('year')).toBe('desc')
    expect(firstDirection('mileage')).toBe('desc')
    expect(firstDirection('vehicle')).toBe('asc')
    expect(firstDirection('condition')).toBe('asc')
  })

  it('cycles first direction, then the opposite, then off', () => {
    const first = nextColumnSort(null, 'price')
    expect(first).toEqual({ key: 'price', direction: 'desc' })

    const second = nextColumnSort(first, 'price')
    expect(second).toEqual({ key: 'price', direction: 'asc' })

    expect(nextColumnSort(second, 'price')).toBeNull()
  })

  it('starts a different column in its own natural direction', () => {
    const onPrice = nextColumnSort(null, 'price')
    expect(nextColumnSort(onPrice, 'type')).toEqual({ key: 'type', direction: 'asc' })
  })
})

describe('sortListings', () => {
  const rows = [
    make('a', { price: 300, manufactureYear: 2015, mileage: 90_000, model: 'Vitz' }),
    make('b', { price: 100, manufactureYear: 2022, mileage: 10_000, model: 'Aqua' }),
    make('c', { price: 200, manufactureYear: 2019, mileage: 50_000, model: 'Prius' }),
  ]

  it('returns the rows untouched when no column is chosen', () => {
    expect(sortListings(rows, null)).toBe(rows)
  })

  it.each([
    ['price', 'desc', ['a', 'c', 'b']],
    ['price', 'asc', ['b', 'c', 'a']],
    ['year', 'desc', ['b', 'c', 'a']],
    ['mileage', 'asc', ['b', 'c', 'a']],
    ['vehicle', 'asc', ['b', 'c', 'a']],
    ['vehicle', 'desc', ['a', 'c', 'b']],
  ] as const)('sorts %s %s', (key, direction, expected) => {
    expect(ids(sortListings(rows, { key, direction }))).toEqual(expected)
  })

  it('compares numbers as numbers, not as text', () => {
    const mixed = [make('x', { price: 9 }), make('y', { price: 100 }), make('z', { price: 20 })]

    expect(ids(sortListings(mixed, { key: 'price', direction: 'asc' }))).toEqual(['x', 'z', 'y'])
  })

  it('sorts by type and condition', () => {
    const list = [
      make('1', { vehicleType: 'LORRY', condition: 'USED' }),
      make('2', { vehicleType: 'BIKE', condition: 'NEW' }),
      make('3', { vehicleType: 'CAR', condition: 'RECONDITIONED' }),
    ]

    expect(ids(sortListings(list, { key: 'type', direction: 'asc' }))).toEqual(['2', '3', '1'])
    expect(ids(sortListings(list, { key: 'condition', direction: 'asc' }))).toEqual(['2', '3', '1'])
  })

  it('keeps a blank value at the bottom in both directions', () => {
    const list = [
      make('has', { condition: 'USED' }),
      make('none', { condition: null }),
      make('new', { condition: 'NEW' }),
    ]

    expect(ids(sortListings(list, { key: 'condition', direction: 'asc' }))).toEqual(['new', 'has', 'none'])
    expect(ids(sortListings(list, { key: 'condition', direction: 'desc' }))).toEqual(['has', 'new', 'none'])
  })

  it('does not change the original array', () => {
    const before = ids(rows)
    sortListings(rows, { key: 'price', direction: 'asc' })

    expect(ids(rows)).toEqual(before)
  })

  it('keeps rows with equal values in their original order', () => {
    const ties = [make('first', { price: 5 }), make('second', { price: 5 }), make('third', { price: 5 })]

    expect(ids(sortListings(ties, { key: 'price', direction: 'desc' }))).toEqual(['first', 'second', 'third'])
  })
})
