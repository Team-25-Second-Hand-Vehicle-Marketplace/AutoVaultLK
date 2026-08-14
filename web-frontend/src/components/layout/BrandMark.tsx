import { Link } from 'react-router-dom'

/**
 * The AutoVaultLK wordmark: a rounded blue tile holding a car glyph, followed
 * by the name. Shared by the header, footer, and both dealer screens so the
 * logo is defined once.
 *
 * `to={null}` renders it as plain markup for contexts that are already inside
 * a link or where navigation would be wrong (e.g. the dealer auth panels).
 */
export function BrandMark({ to = '/' }: { to?: string | null }) {
  const content = (
    <>
      <span className="brand__tile" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15v-2.2l1.8-3.6A2 2 0 0 1 7.6 8h8.8a2 2 0 0 1 1.8 1.2L20 12.8V15" />
          <path d="M4 15h16" />
          <circle cx="8" cy="16.8" r="1.5" />
          <circle cx="16" cy="16.8" r="1.5" />
        </svg>
      </span>
      <span className="brand__name">AutoVaultLK</span>
    </>
  )

  if (to === null) {
    return <span className="brand">{content}</span>
  }

  return (
    <Link to={to} className="brand">
      {content}
    </Link>
  )
}
