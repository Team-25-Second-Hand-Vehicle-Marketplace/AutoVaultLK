import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { filterSearch, getMarketplaceStats } from '../api/search.api'
import type {
  MarketplaceStats,
  VehicleSearchResult,
  VehicleTypeValue,
} from '../api/search.types'
import { CategoryIcon } from '../components/home/CategoryIcon'
import { HeroSearchPanel } from '../components/home/HeroSearchPanel'
import { VehicleCarousel } from '../components/home/VehicleCarousel'
import { humanizeEnum } from '../components/search/vehicle-format'
import { HERO_IMAGE } from '../assets/demo-images'

const nf = new Intl.NumberFormat('en-LK')

export function HomePage() {
  const [stats, setStats] = useState<MarketplaceStats | null>(null)
  const [featured, setFeatured] = useState<VehicleSearchResult[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    getMarketplaceStats(controller.signal)
      .then(setStats)
      .catch((err) => {
        if (!axios.isCancel(err)) console.error('Failed to load stats:', err)
      })

    filterSearch({ sort: 'newest', limit: 16 }, controller.signal)
      .then((res) => setFeatured(res.items))
      .catch((err) => {
        if (!axios.isCancel(err)) {
          console.error('Failed to load featured vehicles:', err)
          setFeatured([])
        }
      })

    return () => controller.abort()
  }, [])

  return (
    <div className="home">
      {}
      <section className="hero">
        <div className="hero__backdrop" aria-hidden="true" />
        <img
          src={HERO_IMAGE}
          alt=""
          className="hero__bg"
          fetchPriority="high"
          aria-hidden="true"
        />
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

          <HeroSearchPanel />
        </div>
      </section>

      <section className="trust-bar">
        <div className="trust-bar__inner">
          <article className="trust-card">
            <span className="trust-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <div>
              <h3>Verified dealers</h3>
              <p>
                Dealer accounts are reviewed before approval, and every listing carries its
                verification status on the card.
              </p>
            </div>
          </article>

          <article className="trust-card">
            <span className="trust-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19V5m0 14h16" />
                <path d="M8 16V9m4 7v-4m4 4V7" />
              </svg>
            </span>
            <div>
              <h3>Honest specifications</h3>
              <p>
                Where a dealer hasn&apos;t supplied a registration year, we say so rather than
                showing the manufacture year in its place.
              </p>
            </div>
          </article>

          <article className="trust-card">
            <span className="trust-card__icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
            </span>
            <div>
              <h3>Search that understands you</h3>
              <p>
                Type what you want in plain English — misspellings included — or narrow it
                down with filters for price, year, mileage, fuel, and district.
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* ── Recommended vehicles ─────────────────────────────── */}
      <section className="section">
        <div className="section__inner">
          <div className="section__head">
            <h2 className="section__title">Recommended vehicles</h2>
            <Link to="/search?sort=newest" className="section__link">
              Show more
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </Link>
          </div>

          <VehicleCarousel items={featured} />
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

      {/* ── Dealer CTA ───────────────────────────────────────── */}
      <section className="cta-band">
        <div className="cta-band__inner">
          <h2>Ready to sell your vehicle?</h2>
          <p>
            Join the dealers already listing on AutoVaultLK. Registration takes a few minutes.
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
