import { Link } from 'react-router-dom'

/** An endless strip of the makes on the site, from the live stats. */
export function BrandMarquee({ makes }: { makes: { make: string; count: number }[] }) {
  if (makes.length === 0) return null
  // Twice, so translating the track by -50% loops without a visible jump.
  const loop = [...makes, ...makes]

  return (
    <div className="nx-marquee" aria-label="Popular makes">
      <div className="nx-marquee__track">
        {loop.map((m, i) => (
          <Link
            key={`${m.make}-${i}`}
            to={`/search?make=${encodeURIComponent(m.make)}`}
            className="nx-marquee__item"
            tabIndex={i >= makes.length ? -1 : 0}
            aria-hidden={i >= makes.length ? true : undefined}
          >
            {m.make}
            <sup>{m.count}</sup>
          </Link>
        ))}
      </div>
    </div>
  )
}
