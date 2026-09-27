import { Link } from 'react-router-dom'

export function BrandMark({ to = '/' }: { to?: string | null }) {
  const content = (
    <>
      <span className="brand__tile" aria-hidden="true">
        {/* A vault dial crossed by a road: the "V" in vault, the line of travel. */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M7.5 8.5 12 17l4.5-8.5" />
          <path d="M12 3v2.2M3 12h2.2M18.8 12H21" opacity=".55" />
        </svg>
      </span>
      <span className="brand__name">
        AutoVault<span>LK</span>
      </span>
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
