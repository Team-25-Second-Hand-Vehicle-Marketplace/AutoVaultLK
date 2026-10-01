import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Heart, Plus, Search } from 'lucide-react'
import type { MarketplaceStats } from '../../api/search.types'
import type { ImageSlotId } from '../../assets/image-slots'
import { SlotImage } from '../ui/SlotImage'
import { VehicleTypeIcon } from '../ui/VehicleTypeIcon'
import { CountUp } from './CountUp'
import { HeroSearch } from './HeroSearch'

const SLIDES: ImageSlotId[] = ['hero-1', 'hero-2', 'hero-3']
const SLIDE_MS = 7000

const PILLS = [
  { label: 'All vehicles', to: '/search', type: null },
  { label: 'Cars', to: '/search?vehicleType=CAR', type: 'CAR' },
  { label: 'SUVs', to: '/search?vehicleType=SUV', type: 'SUV' },
  { label: 'Bikes', to: '/search?vehicleType=BIKE', type: 'BIKE' },
  { label: 'Three wheelers', to: '/search?vehicleType=THREE_WHEELER', type: 'THREE_WHEELER' },
]

const TITLE = ['Find', 'the', 'one', 'worth', 'driving.']

export function Hero({ stats }: { stats: MarketplaceStats | null }) {
  const [slide, setSlide] = useState(0)

  // Re-armed on every slide change, so a manual arrow click restarts the clock.
  useEffect(() => {
    const id = window.setTimeout(() => setSlide((s) => (s + 1) % SLIDES.length), SLIDE_MS)
    return () => window.clearTimeout(id)
  }, [slide])

  const go = (delta: number) => setSlide((s) => (s + delta + SLIDES.length) % SLIDES.length)

  return (
    <section className="nx-hero">
      <div className="nx-hero__bg" aria-hidden="true">
        <AnimatePresence mode="sync">
          <motion.div
            key={slide}
            className="nx-hero__slide"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1.12 }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.4 },
              scale: { duration: SLIDE_MS / 1000 + 2, ease: 'linear' },
            }}
          >
            <SlotImage slot={SLIDES[slide]} priority className="nx-hero__img" />
          </motion.div>
        </AnimatePresence>
        <div className="nx-hero__shade" />
        <div className="nx-hero__grain" />
        <span className="nx-hero__beam" />
      </div>

      <div className="nx-hero__inner">
        <div className="nx-hero__copy">
          <motion.p
            className="nx-eyebrow"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <span className="nx-eyebrow__dot" /> Sri Lanka&apos;s second-hand vehicle marketplace
          </motion.p>

          <h1 className="nx-hero__title" aria-label={TITLE.join(' ')}>
            {TITLE.map((word, i) => (
              <span className="nx-hero__word-wrap" key={word} aria-hidden="true">
                <motion.span
                  className={i >= 3 ? 'nx-hero__word nx-hero__word--gold' : 'nx-hero__word'}
                  initial={{ y: '110%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.85, delay: 0.15 + i * 0.09, ease: [0.2, 0.7, 0.2, 1] }}
                >
                  {word}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            className="nx-hero__sub"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
          >
            Real listings from verified dealers. Search the way you talk, misspellings and all,
            and see honest specs, not marketing.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.85 }}
          >
            <HeroSearch />
          </motion.div>
        </div>

        <motion.aside
          className="nx-hero__actions"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 1 }}
          aria-label="Quick actions"
        >
          <Link to="/search" className="nx-orb">
            <span>Browse all</span>
            <i>
              <Search size={18} />
            </i>
          </Link>
          <Link to="/dealer/login" className="nx-orb">
            <span>Sell yours</span>
            <i>
              <Plus size={18} />
            </i>
          </Link>
          <Link to="/saved" className="nx-orb">
            <span>Your saved</span>
            <i>
              <Heart size={18} />
            </i>
          </Link>
        </motion.aside>
      </div>

      <div className="nx-hero__foot">
        <div className="nx-hero__stats">
          <div className="nx-glass-stat">
            <b>{stats ? <CountUp value={stats.vehicleCount} /> : '-'}</b>
            <span>Vehicles listed</span>
          </div>
          <div className="nx-glass-stat">
            <b>{stats ? <CountUp value={stats.verifiedDealerCount} /> : '-'}</b>
            <span>Verified dealers</span>
          </div>
          <div className="nx-glass-stat">
            <b>{stats ? <CountUp value={stats.makeCount} /> : '-'}</b>
            <span>Makes</span>
          </div>
        </div>

        <div className="nx-hero__pills">
          {PILLS.map((p, i) => (
            <Link key={p.label} to={p.to} className={i === 0 ? 'nx-pill is-active' : 'nx-pill'}>
              {p.type && <VehicleTypeIcon type={p.type} size={18} />}
              {p.label}
            </Link>
          ))}
        </div>

        <div className="nx-hero__nav">
          <div className="nx-hero__dots" aria-hidden="true">
            {SLIDES.map((s, i) => (
              <span key={s} className={i === slide ? 'is-on' : ''} />
            ))}
          </div>
          <button type="button" className="nx-square-btn" onClick={() => go(-1)} aria-label="Previous slide">
            <ArrowLeft size={18} />
          </button>
          <button type="button" className="nx-square-btn" onClick={() => go(1)} aria-label="Next slide">
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  )
}
