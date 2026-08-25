import type { NlParse } from '../../api/search.types'
import { describeParsedFilters } from './parse-summary'

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
