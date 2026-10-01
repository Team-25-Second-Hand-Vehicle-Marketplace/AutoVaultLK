import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Lenis from 'lenis'

/**
 * Eased, inertial page scrolling (Lenis). Skipped for people who ask for reduced
 * motion. Also resets to the top on route changes, which Lenis and the router
 * would otherwise leave at the previous page's scroll position.
 */
export function SmoothScroll() {
  const { pathname } = useLocation()

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // allowNestedScroll: without it Lenis takes every wheel event for the page, so
    // scrollable panels inside it (dialogs, long lists) would never scroll.
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, allowNestedScroll: true })
    let frame = requestAnimationFrame(function raf(time) {
      lenis.raf(time)
      frame = requestAnimationFrame(raf)
    })

    return () => {
      cancelAnimationFrame(frame)
      lenis.destroy()
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
