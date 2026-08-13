import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { filterSearch, getMarketplaceStats } from '../api/search.api'
import type {
  MarketplaceStats,
  VehicleSearchResult,
  VehicleTypeValue,
} from '../api/search.types'
import { VehicleCard } from '../components/search/VehicleCard'
import { VehicleCardSkeleton } from '../components/search/VehicleCardSkeleton'
import { CategoryIcon } from '../components/home/CategoryIcon'
import { humanizeEnum } from '../components/search/vehicle-format'

/** Quick-search chips under the hero, chosen from makes that really exist. */
const QUICK_SEARCHES = ['Toyota Aqua', 'Honda Vezel', 'Suzuki Wagon R', 'Nissan Leaf']

const nf = new Intl.NumberFormat('en-LK')

export function HomePage() {
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [stats, setStats] = useState<MarketplaceStats | null>(null)
  const [featured, setFeatured] = useState<VehicleSearchResult[] | null>(null)

  // Newest four live listings stand in for "featured": there is no `featured`
  // column on vehicles and no backend concept of promotion, so ranking by
  // recency is the honest interpretation rather than inventing a flag.
  useEffect(() => {
    const controller = new AbortController()

    getMarketplaceStats(controller.signal)
      .then(setStats)
      .catch((err) => {
        if (!axios.isCancel(err)) console.error('Failed to load stats:', err)
      })

    filterSearch({ sort: 'newest', limit: 4 }, controller.signal)
      .then((res) => setFeatured(res.items))
      .catch((err) => {
        if (!axios.isCancel(err)) {
          console.error('Failed to load featured vehicles:', err)
          setFeatured([])
        }
      })

    return () => controller.abort()
  }, [])

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = keyword.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
  }

  return (
    <div className="home">
      {/* ── Hero ─────────────────────────────────────────────────
          The design reference uses a full-bleed photo of a car behind the
          headline. This project ships no licensed vehicle photography (the
          only asset in src/assets is an unrelated abstract graphic), so the
          backdrop is a rendered gradient instead of a stock image that
          doesn't belong to the project. Drop a photo in as .hero__bg when
          one is available — the scrim above it already handles contrast. */}
      <section className="hero">
        <div className="hero__backdrop" aria-hidden="true" />
        <div className="hero__scrim" aria-hidden="true" />

        <div className="hero__inner">
          <p className="hero__eyebrow">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />
            </svg>
            Sri Lanka&apos;s trusted second-hand vehicle marketplace
          </p>

          <h1 className="hero__title">
            Find Your <span className="hero__title-accent">Perfect</span>
            <br />
            Second-Hand Vehicle
          </h1>

          <p className="hero__subtitle">
            {stats
              ? `Browse ${nf.format(stats.vehicleCount)} live listings from ${stats.dealerCount} dealers across Sri Lanka.`
              : 'Browse live listings from dealers across Sri Lanka.'}{' '}
            Every listing checked before it goes live.
          </p>

          <div className="hero__search">
            <form className="hero-search" onSubmit={submitSearch}>
              <div className="hero-search__row">
                <div className="hero-search__field">
                  <svg
                    className="hero-search__icon"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    placeholder="Make, model, or keyword…"
                    aria-label="Search vehicles"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                </div>
                <button type="submit" className="button button--primary button--lg">
                  Search
                </button>
              </div>

              <div className="hero-search__quick">
                {QUICK_SEARCHES.map((term) => (
                  <Link key={term} to={`/search?q=${encodeURIComponent(term)}`} className="chip">
                    {term}
                  </Link>
                ))}
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* ── Stats band ───────────────────────────────────────────
          Only figures with a real source. The reference also shows
          "Happy Buyers" and a satisfaction rate; this system has no orders
          or reviews to compute either from, so they are omitted. */}
      <section className="stats-band">
        <div className="stats-band__inner">
          <div className="stat">
            <div className="stat__value">{stats ? nf.format(stats.vehicleCount) : '—'}</div>
            <div className="stat__label">Vehicles Listed</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats ? nf.format(stats.verifiedDealerCount) : '—'}</div>
            <div className="stat__label">Verified Dealers</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats ? nf.format(stats.makeCount) : '—'}</div>
            <div className="stat__label">Brands Available</div>
          </div>
          <div className="stat">
            <div className="stat__value">{stats ? nf.format(stats.categories.length) : '—'}</div>
            <div className="stat__label">Vehicle Types</div>
          </div>
        </div>
      </section>

      {/* ── Featured vehicles ────────────────────────────────── */}
      <section className="section">
        <div className="section__inner">
          <div className="section__head">
            <div>
              <p className="section__eyebrow">Latest listings</p>
              <h2 className="section__title">Recently Added</h2>
            </div>
            <Link to="/search?sort=newest" className="section__link">
              View all
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </div>

          <div className="vehicle-grid vehicle-grid--4">
            {featured === null
              ? Array.from({ length: 4 }, (_, i) => <VehicleCardSkeleton key={i} />)
              : featured.map((item) => <VehicleCard key={item.id} result={item} />)}
          </div>

          {featured?.length === 0 && (
            <p className="section__empty">No listings available right now.</p>
          )}
        </div>
      </section>

      {/* ── Categories ───────────────────────────────────────── */}
      <section className="section section--alt">
        <div className="section__inner">
          <div className="section__head section__head--center">
            <div>
              <p className="section__eyebrow">Browse by type</p>
              <h2 className="section__title">Vehicle Categories</h2>
            </div>
          </div>

          <div className="category-grid">
            {(stats?.categories ?? []).map((cat) => (
              <Link
                key={cat.vehicleType}
                to={`/search?vehicleType=${cat.vehicleType}`}
                className="category-tile"
              >
                <span className="category-tile__icon">
                  <CategoryIcon type={cat.vehicleType as VehicleTypeValue} />
                </span>
                <span className="category-tile__name">{humanizeEnum(cat.vehicleType)}</span>
                <span className="category-tile__count">{nf.format(cat.count)}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Brands ───────────────────────────────────────────── */}
      <section className="section">
        <div className="section__inner">
          <div className="section__head section__head--center">
            <div>
              <p className="section__eyebrow">All makes and models</p>
              <h2 className="section__title">Popular Brands</h2>
            </div>
          </div>

          <div className="brand-grid">
            {(stats?.topMakes ?? []).map((brand) => (
              <Link
                key={brand.make}
                to={`/search?make=${encodeURIComponent(brand.make)}`}
                className="brand-tile"
              >
                <span className="brand-tile__mark" aria-hidden="true">
                  <CategoryIcon type="CAR" />
                </span>
                <span className="brand-tile__name">{brand.make}</span>
                <span className="brand-tile__count">{brand.count}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why choose us ────────────────────────────────────── */}
      <section className="section section--alt">
        <div className="section__inner">
          <div className="section__head section__head--center">
            <div>
              <p className="section__eyebrow">Why choose us</p>
              <h2 className="section__title">Buy and Sell with Confidence</h2>
            </div>
          </div>

          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-card__icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </span>
              <h3>Verified Dealers</h3>
              <p>
                Dealer accounts are reviewed before approval, and every listing shows its
                verification status.
              </p>
            </article>

            <article className="feature-card">
              <span className="feature-card__icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
              </span>
              <h3>Precise Filters</h3>
              <p>
                Filter by type, make, price, year, mileage, fuel, transmission, district, and
                detailed specs like seats and drive type.
              </p>
            </article>

            <article className="feature-card">
              <span className="feature-card__icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 21s-6.7-4.35-9.3-8.1C.8 10.1 1.4 6.6 4.3 5.1c2.2-1.1 4.6-.4 6 1.4l1.7 2.1 1.7-2.1c1.4-1.8 3.8-2.5 6-1.4 2.9 1.5 3.5 5 1.6 7.8C18.7 16.65 12 21 12 21z" />
                </svg>
              </span>
              <h3>Save Your Shortlist</h3>
              <p>
                Keep the vehicles you like in one place, and pick your search back up exactly
                where you left it.
              </p>
            </article>

            <article className="feature-card">
              <span className="feature-card__icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 19V5m0 14h16" />
                  <path d="M8 16V9m4 7v-4m4 4V7" />
                </svg>
              </span>
              <h3>Honest Listings</h3>
              <p>
                Where a dealer hasn&apos;t given a registration year, we say so instead of
                showing the manufacture year in its place.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ── Dealer CTA ───────────────────────────────────────── */}
      <section className="cta-band">
        <div className="cta-band__inner">
          <h2>Ready to sell your vehicle?</h2>
          <p>
            Join the dealers already listing on AutoMarket. Registration takes a few minutes.
          </p>
          <div className="cta-band__actions">
            <Link to="/dealer/register" className="button button--inverse button--lg">
              Register as Dealer
            </Link>
            <Link to="/dealer/login" className="button button--outline-light button--lg">
              Dealer Login
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
