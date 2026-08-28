import type { ReactNode } from 'react'

export type PillVariant = 'neutral' | 'ok' | 'warn' | 'danger'

interface PillProps {
  variant?: PillVariant
  children: ReactNode
}

/**
 * Wraps the `.admin-pill` / `.admin-pill--*` classes already defined in
 * admin.css. Previously each admin page picked the variant with its own
 * inline conditional (or, in AdminUploadsPage, a separate statusClass()
 * helper) — this is the one place that mapping lives now.
 */
export function Pill({ variant = 'neutral', children }: PillProps) {
  const classes = variant === 'neutral' ? 'admin-pill' : `admin-pill admin-pill--${variant}`
  return <span className={classes}>{children}</span>
}
