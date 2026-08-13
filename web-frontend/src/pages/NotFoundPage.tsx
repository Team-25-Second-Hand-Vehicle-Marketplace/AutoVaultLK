import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="error-page">
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist or may have been moved.</p>
      <Link className="button button--primary" to="/search">
        Browse vehicles
      </Link>
    </div>
  )
}
