const MAX_VISIBLE_PAGES = 7

function getVisiblePages(page: number, totalPages: number): number[] {
  if (totalPages <= MAX_VISIBLE_PAGES) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const half = Math.floor(MAX_VISIBLE_PAGES / 2)
  let start = Math.max(1, page - half)
  const end = Math.min(totalPages, start + MAX_VISIBLE_PAGES - 1)
  start = Math.max(1, end - MAX_VISIBLE_PAGES + 1)
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  const visiblePages = getVisiblePages(page, totalPages)

  return (
    <nav className="pagination" aria-label="Search results pages">
      <button
        className="pagination__nav"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹ Previous
      </button>

      <div className="pagination__pages">
        {visiblePages.map((n) => (
          <button
            key={n}
            className={n === page ? 'pagination__page pagination__page--active' : 'pagination__page'}
            aria-current={n === page ? 'page' : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>

      <button
        className="pagination__nav"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next ›
      </button>
    </nav>
  )
}
