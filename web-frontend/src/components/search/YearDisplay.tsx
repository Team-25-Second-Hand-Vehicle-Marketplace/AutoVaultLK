import type { VehicleSearchResult } from '../../api/search.types'

/**
 * registrationYear is nullable because dealers omit it, and the backend
 * falls back to manufactureYear via COALESCE so the listing is never hidden
 * from a year-filtered search. This is where that fallback becomes visible
 * and honest to the buyer, instead of presenting a manufacture year as if it
 * were a registration year.
 */
export function YearDisplay({
  result,
}: {
  result: Pick<VehicleSearchResult, 'registrationYear' | 'manufactureYear'>
}) {
  if (result.registrationYear === null) {
    return (
      <span title="Registration year not provided by the dealer">
        {result.manufactureYear} <span className="year-note">(Mfg.)</span>
      </span>
    )
  }
  if (result.registrationYear !== result.manufactureYear) {
    return (
      <span>
        {result.registrationYear}{' '}
        <span className="year-note">(Mfg. {result.manufactureYear})</span>
      </span>
    )
  }
  return <span>{result.registrationYear}</span>
}
