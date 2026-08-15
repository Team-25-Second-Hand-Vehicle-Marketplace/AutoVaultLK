import { useEffect, useRef, useState } from 'react'
import type { VehicleSearchResult } from '../../api/search.types'
import { VehicleCard } from '../search/VehicleCard'
import { VehicleCardSkeleton } from '../search/VehicleCardSkeleton'

interface Props {
  items: VehicleSearchResult[] | null
  /** Cards per page at desktop width; also the skeleton count while loading. */
  perPage?: number
}

export function VehicleCarousel({ items, perPage = 4 }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0)

  const pageCount = items ? Math.max(1, Math.ceil(items.length / perPage)) : 1

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const onScroll = () => {
      const pageWidth = track.clientWidth
      if (pageWidth === 0) return
      setPage(Math.round(track.scrollLeft / pageWidth))
    }

    track.addEventListener('scroll', onScroll, { passive: true })
    return () => track.removeEventListener('scroll', onScroll)
  }, [items])

  const goTo = (next: number) => {
    const track = trackRef.current
    if (!track) return
    const clamped = Math.max(0, Math.min(next, pageCount - 1))
    track.scrollTo({ left: clamped * track.clientWidth, behavior: 'smooth' })
    setPage(clamped)
  }

  if (items !== null && items.length === 0) {
    return <p className="section__empty">No listings available right now.</p>
  }

  return (
    <div className="carousel">
      <div className="carousel__track" ref={trackRef}>
        {items === null
          ? Array.from({ length: perPage }, (_, i) => (
              <div className="carousel__cell" key={i}>
                <VehicleCardSkeleton />
              </div>
            ))
          : items.map((item) => (
              <div className="carousel__cell" key={item.id}>
                <VehicleCard result={item} />
              </div>
            ))}
      </div>

      {/* A single page needs no controls — the arrows would be permanently
          disabled and the dot row would be one inert dot. */}
      {pageCount > 1 && (
        <div className="carousel__controls">
          <div className="carousel__arrows">
            <button
              type="button"
              className="carousel__arrow"
              onClick={() => goTo(page - 1)}
              disabled={page === 0}
              aria-label="Previous vehicles"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button
              type="button"
              className="carousel__arrow"
              onClick={() => goTo(page + 1)}
              disabled={page >= pageCount - 1}
              aria-label="Next vehicles"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          <div className="carousel__dots">
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                className={i === page ? 'carousel__dot carousel__dot--active' : 'carousel__dot'}
                onClick={() => goTo(i)}
                aria-label={`Go to page ${i + 1} of ${pageCount}`}
                aria-current={i === page}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
