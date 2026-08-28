interface ErrorBannerProps {
  message: string | null | undefined
}

/**
 * The `form-error form-error--banner` + role="alert" block, previously
 * hand-typed identically across every auth form and admin page. Renders
 * nothing when there's no message, so callers can write
 * `<ErrorBanner message={error} />` unconditionally.
 */
export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null

  return (
    <div className="form-error form-error--banner" role="alert">
      {message}
    </div>
  )
}
