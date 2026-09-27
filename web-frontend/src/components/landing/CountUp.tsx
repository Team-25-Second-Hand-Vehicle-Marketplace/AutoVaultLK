import { useEffect, useRef, useState } from 'react'
import { animate, useInView } from 'motion/react'

const nf = new Intl.NumberFormat('en-LK')

/** Counts from 0 to `value` the first time it is on screen. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(0, value, {
      duration: 1.6,
      ease: 'easeOut',
      onUpdate: (v) => setShown(Math.round(v)),
    })
    return () => controls.stop()
  }, [inView, value])

  return <span ref={ref}>{nf.format(shown)}</span>
}
