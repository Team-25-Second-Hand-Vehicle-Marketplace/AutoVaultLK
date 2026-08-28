import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'inverse' | 'outline-light'
export type ButtonSize = 'sm' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Stretches the button to fill its container (button--block). */
  block?: boolean
}

/**
 * Wraps the `.button` / `.button--*` classes already defined in
 * app.css / theme.css / admin.css — no new styling, just a single place to
 * assemble the class string instead of hand-typing it at each call site.
 */
export function Button({
  variant = 'primary',
  size,
  block,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = [
    'button',
    `button--${variant}`,
    size && `button--${size}`,
    block && 'button--block',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <button type={type} className={classes} {...rest} />
}
