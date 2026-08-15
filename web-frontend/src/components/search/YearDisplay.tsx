import type { VehicleSearchResult } from '../../api/search.types'


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
