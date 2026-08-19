import type { NlParse } from '../../api/search.types'
import { formatPrice, humanizeEnum } from './vehicle-format'

const SKIP = new Set(['page', 'limit', 'facets', 'sort', 'q'])

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

/** One-line summary of filters the NL parser actually applied. */
export function describeParsedFilters(applied: Record<string, unknown>): string[] {
  const parts: string[] = []

  for (const key of ['make', 'model', 'vehicleType', 'condition', 'fuelType', 'transmissionType']) {
    const values = asList(applied[key]).map(humanizeEnum)
    if (values.length > 0) parts.push(values.join(', '))
  }

  const minPrice = applied.minPrice
  const maxPrice = applied.maxPrice
  if (typeof minPrice === 'number' && typeof maxPrice === 'number') {
    parts.push(`LKR ${formatPrice(minPrice)} – ${formatPrice(maxPrice)}`)
  } else if (typeof maxPrice === 'number') {
    parts.push(`under LKR ${formatPrice(maxPrice)}`)
  } else if (typeof minPrice === 'number') {
    parts.push(`over LKR ${formatPrice(minPrice)}`)
  }

  const minYear = applied.minYear
  const maxYear = applied.maxYear
  if (typeof minYear === 'number' && typeof maxYear === 'number') {
    parts.push(`${minYear}–${maxYear}`)
  } else if (typeof maxYear === 'number') {
    parts.push(`up to ${maxYear}`)
  } else if (typeof minYear === 'number') {
    parts.push(`from ${minYear}`)
  }

  if (typeof applied.maxMileage === 'number') {
    parts.push(`under ${formatPrice(applied.maxMileage)} km`)
  }

  const specs = applied.specs
  if (Array.isArray(specs) && specs.length > 0) {
    parts.push(
      specs
        .map((spec: { key?: string; value?: string }) => spec.value ?? spec.key)
        .filter(Boolean)
        .join(', '),
    )
  }

  for (const [key, value] of Object.entries(applied)) {
    if (SKIP.has(key) || value === undefined) continue
    if (
      [
        'make',
        'model',
        'vehicleType',
        'condition',
        'fuelType',
        'transmissionType',
        'minPrice',
        'maxPrice',
        'minYear',
        'maxYear',
        'maxMileage',
        'minMileage',
        'specs',
      ].includes(key)
    ) {
      continue
    }
    const values = asList(value).map(humanizeEnum)
    if (values.length > 0) parts.push(values.join(', '))
  }

  return parts
}

export function ParseNotice({
  parse,
  appliedFilters,
}: {
  parse: NlParse
  appliedFilters: Record<string, unknown>
}) {
  const parts = describeParsedFilters(appliedFilters)
  if (parts.length === 0 && !parse.semanticText) return null

  return (
    <p className="parse-notice">
      {parts.length > 0
        ? `Understood as ${parts.join(' · ')}`
        : 'No structured filters — matching leftover text.'}
    </p>
  )
}
