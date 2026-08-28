import { describe, expect, it } from 'vitest'
import { formatDate } from '../../utils/format'

describe('formatDate', () => {
  it('formats an ISO date string using en-LK medium date and short time style', () => {
    const result = formatDate('2026-01-15T10:30:00.000Z')
    expect(result).toEqual(new Date('2026-01-15T10:30:00.000Z').toLocaleString('en-LK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }))
  })

  it('produces a non-empty, human-readable string', () => {
    const result = formatDate('2026-06-01T00:00:00.000Z')
    expect(result.length).toBeGreaterThan(0)
  })
})
