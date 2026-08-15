import type { NlParse } from '../../api/search.types'

/** Below this the parser is guessing more than it is reading. */
const LOW_CONFIDENCE = 0.5


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
