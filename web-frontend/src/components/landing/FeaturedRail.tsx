import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { VehicleSearchResult } from '../../api/search.types'
import { VehicleCard } from '../search/VehicleCard'
import { VehicleCardSkeleton } from '../search/VehicleCardSkeleton'
import { Reveal } from './Reveal'

export function FeaturedRail({ items }: { items: VehicleSearchResult[] | null }) {
  const track = useRef<HTMLDivElement>(null)

  const scrollBy = (dir: 1 | -1) => {
    const el = track.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className="nx-section">
      <div className="nx-wrap">
        <Reveal className="nx-section__head">
          <div>
            <p className="nx-kicker">Fresh on the lot</p>
            <h2 className="nx-h2">Just listed</h2>
          </div>
          <div className="nx-section__tools">
            <Link to="/search?sort=newest" className="nx-textlink">
              See everything <ArrowRight size={16} />
            </Link>
            <button type="button" className="nx-square-btn" onClick={() => scrollBy(-1)} aria-label="Scroll left">
              <ArrowLeft size={18} />
            </button>
            <button type="button" className="nx-square-btn" onClick={() => scrollBy(1)} aria-label="Scroll right">
              <ArrowRight size={18} />
            </button>
          </div>
        </Reveal>
      </div>

      {items !== null && items.length === 0 ? (
        <p className="nx-empty">No listings available right now.</p>
      ) : (
        <div className="nx-rail" ref={track}>
          {items === null
            ? Array.from({ length: 4 }, (_, i) => (
                <div className="nx-rail__cell" key={i}>
                  <VehicleCardSkeleton />
                </div>
              ))
            : items.map((item) => (
                <div className="nx-rail__cell" key={item.id}>
                  <VehicleCard result={item} />
                </div>
              ))}
        </div>
      )}
    </section>
  )
}
