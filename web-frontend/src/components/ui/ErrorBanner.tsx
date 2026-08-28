interface ErrorBannerProps {
  message: string | null | undefined
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null

  return (
    <div className="form-error form-error--banner" role="alert">
      {message}
    </div>
  )
}
