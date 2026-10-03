import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

const EASE_OUT = [0.22, 1, 0.36, 1] as const

const variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
  // Short on purpose: mode="wait" holds the next page back until this ends.
  exit: { opacity: 0, y: -6, transition: { duration: 0.14, ease: 'easeIn' as const } },
}

interface Props {
  /** Changes whenever the content should animate out and the next animate in. */
  id: string
  children: ReactNode
}

export function PageTransition({ id, children }: Props) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
