import { useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import type { ImageSlotId } from '../../assets/image-slots'
import { SlotImage } from '../ui/SlotImage'

const STEPS: { n: string; title: string; body: string; slot: ImageSlotId }[] = [
  {
    n: '01',
    title: 'Say what you want, in your own words.',
    body: 'Type “Toyata Corrola under 8.5m deisel” and we still find the Corolla. Or narrow it down with filters for price, year, mileage, fuel and district.',
    slot: 'story-search',
  },
  {
    n: '02',
    title: 'Every dealer is checked before they list.',
    body: 'Dealer accounts are reviewed before approval, and each listing carries its verification status right on the card. No guessing who you are buying from.',
    slot: 'story-verified',
  },
  {
    n: '03',
    title: 'Honest specs. Then you drive away.',
    body: 'Where a dealer has not supplied a registration year, we say so instead of quietly showing the manufacture year. What you see is what you are buying.',
    slot: 'story-drive',
  },
]

/**
 * Scroll-driven story: the left column stays put while the steps advance and
 * the picture on the right crossfades with them. Collapses to a simple stack on
 * small screens (see .nx-story in next.css).
 */
export function StoryScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length))))
  })

  return (
    <section className="nx-story" ref={ref} aria-label="How AutoVaultLK works">
      <div className="nx-story__stick">
        <div className="nx-wrap nx-story__grid">
          <div className="nx-story__copy">
            <p className="nx-kicker">How it works</p>
            <ol className="nx-story__steps">
              {STEPS.map((s, i) => (
                <li key={s.n} className={i === active ? 'is-active' : ''}>
                  <span className="nx-story__n">{s.n}</span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="nx-story__bar" aria-hidden="true">
              <motion.span style={{ scaleX: scrollYProgress }} />
            </div>
          </div>

          <div className="nx-story__media">
            <AnimatePresence mode="wait">
              <motion.div
                key={STEPS[active].slot}
                className="nx-story__frame"
                initial={{ opacity: 0, scale: 1.06 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6 }}
              >
                <SlotImage slot={STEPS[active].slot} className="nx-story__img" />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
