import type { ReactNode } from 'react'
import { motion } from 'motion/react'

interface Props {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}

/** Fades and lifts its children in once, the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 28, className }: Props) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1], delay }}
    >
      {children}
    </motion.div>
  )
}
