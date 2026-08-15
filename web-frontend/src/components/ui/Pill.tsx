import type { ReactNode } from 'react'

export type PillVariant = 'neutral' | 'ok' | 'warn' | 'danger'

interface PillProps {
  variant?: PillVariant
  children: ReactNode
}

export function Pill({ variant = 'neutral', children }: PillProps) {
  const classes = variant === 'neutral' ? 'admin-pill' : `admin-pill admin-pill--${variant}`
  return <span className={classes}>{children}</span>
}
