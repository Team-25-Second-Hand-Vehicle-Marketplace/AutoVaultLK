import type { NlParse } from '../../api/search.types'

/** Below this the parser is guessing more than it is reading. */
const LOW_CONFIDENCE = 0.5

/**
 * Surfaces an NL search that went wrong — and stays silent when it didn't.
 *
 * This replaces the old ParseNotice, which printed "Understood as …" after
 * every natural-language search. That was noise for two reasons: it restated
 * the filters ActiveFilterChips already renders directly above it, from the
 * same appliedFilters object, and it fired on success, when there is nothing
 * the buyer needs to do. A message that appears every time teaches people to
 * stop reading it, so it was also the message least likely to be read on the
 * occasion it mattered.
 *
 * The signal worth showing is the opposite case: words the parser could not
 * place, or a parse it is not confident in. Both mean results may be missing
 * something the buyer asked for, and both are actionable — the chips above
 * show what *was* applied, so the buyer can see the gap and refine.
 *
 * Deliberately NOT shown: usedGroqFallback, usedSemanticRanking, and
 * usedTrigramFallback. Those describe which internal strategy answered the
 * query — useful in a log, meaningless to a buyer, and alarming when the
 * fallback worked perfectly well.
 */
export function ParseWarning({ parse }: { parse: NlParse }) {
  const unresolved = parse.unresolvedTokens.filter((t) => t.trim() !== '')
  const lowConfidence = parse.confidence < LOW_CONFIDENCE

  // The common case: the parse was clean, so this renders nothing at all.
  if (unresolved.length === 0 && !lowConfidence) return null

  return (
    <div className="parse-warning" role="status">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.5" />
      </svg>
      <span>
        {unresolved.length > 0 ? (
          <>
            Couldn&apos;t interpret{' '}
            {unresolved.map((token, i) => (
              <span key={token}>
                {i > 0 && ', '}
                <strong>{token}</strong>
              </span>
            ))}
            . Those words were ignored — check the filters above, or refine them in the sidebar.
          </>
        ) : (
          <>
            This search was hard to read, so some results may be off. Check the filters above,
            or set them in the sidebar.
          </>
        )}
      </span>
    </div>
  )
}
