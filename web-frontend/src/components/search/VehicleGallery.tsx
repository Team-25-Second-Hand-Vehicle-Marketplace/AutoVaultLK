import { useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * The detail page's photo viewer. Every photo is a thumbnail — the main one
 * included — and clicking one (or the arrows, or ←/→ with the gallery focused)
 * swaps it into the large frame. Before this, the thumbnails were a dead strip
 * of the *other* photos: you could see there were more, but not open them.
 *
 * A listing's own photos only; with none, the caller shows its placeholder.
 */
export function VehicleGallery({ images, alt }: { images: string[]; alt: string }) {
  const [index, setIndex] = useState(0)
  const count = images.length

  if (count === 0) return null

  // Stays valid if the photo list shrinks under it (navigating between listings).
  const current = Math.min(index, count - 1)
  const go = (next: number) => setIndex((next + count) % count)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(current + 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(current - 1)
    }
  }

  return (
    <div
      className="detail-gallery"
      role="group"
      aria-roledescription="carousel"
      aria-label={`${alt} photos`}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="detail-gallery__stage">
        <img
          src={images[current]}
          alt={`${alt} — photo ${current + 1} of ${count}`}
          className="detail-gallery__primary"
        />

        {count > 1 && (
          <>
            <button
              type="button"
              className="detail-gallery__nav detail-gallery__nav--prev"
              aria-label="Previous photo"
              onClick={() => go(current - 1)}
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              className="detail-gallery__nav detail-gallery__nav--next"
              aria-label="Next photo"
              onClick={() => go(current + 1)}
            >
              <ChevronRight size={22} />
            </button>
            <span className="detail-gallery__counter" aria-hidden="true">
              {current + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <ul className="detail-gallery__thumbs">
          {images.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                className={`detail-gallery__thumb-btn${i === current ? ' is-active' : ''}`}
                aria-label={`Show photo ${i + 1} of ${count}`}
                aria-current={i === current}
                onClick={() => setIndex(i)}
              >
                <img src={src} alt="" className="detail-gallery__thumb" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
