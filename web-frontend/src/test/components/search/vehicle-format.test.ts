import { describe, expect, it } from 'vitest'
import { formatMileage, formatPrice, humanizeEnum } from '../../../components/search/vehicle-format'

describe('formatPrice', () => {
  it('formats a whole number with thousands separators and no decimals', () => {
    expect(formatPrice(4500000)).toBe('4,500,000')
  })

  it('rounds away fractional cents', () => {
    expect(formatPrice(1999.99)).toBe('2,000')
  })

  it('formats zero', () => {
    expect(formatPrice(0)).toBe('0')
  })
})

describe('formatMileage', () => {
  it('formats kilometers with a trailing unit', () => {
    expect(formatMileage(45000)).toBe('45,000 km')
  })

  it('formats zero mileage', () => {
    expect(formatMileage(0)).toBe('0 km')
  })
})

describe('humanizeEnum', () => {
  it('replaces underscores with spaces', () => {
    expect(humanizeEnum('THREE_WHEELER')).toBe('THREE WHEELER')
  })

  it('replaces multiple underscores', () => {
    expect(humanizeEnum('SUV_CROSSOVER_TYPE')).toBe('SUV CROSSOVER TYPE')
  })

  it('leaves strings without underscores unchanged', () => {
    expect(humanizeEnum('SEDAN')).toBe('SEDAN')
  })
})
