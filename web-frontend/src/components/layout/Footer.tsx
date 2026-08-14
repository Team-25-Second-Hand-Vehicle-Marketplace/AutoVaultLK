import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'

/**
 * Site footer.
 *
 * Every link here points at a route that exists. The design reference also
 * lists Careers, Press, Blog, Privacy, Terms, and social accounts — none of
 * which exist in this project — so those are omitted rather than rendered as
 * links to nowhere. The price-bracket links use LKR thresholds that match the
 * real inventory range.
 */
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <BrandMark />
          <p>
            Sri Lanka&apos;s second-hand vehicle marketplace. Browse listings from verified
            dealers with filters that actually narrow things down.
          </p>
        </div>

        <nav className="site-footer__col" aria-label="Browse">
          <h3>Browse</h3>
          <Link to="/search">All vehicles</Link>
          <Link to="/search?vehicleType=CAR">Cars</Link>
          <Link to="/search?vehicleType=SUV">SUVs</Link>
          <Link to="/search?vehicleType=BIKE">Bikes</Link>
          <Link to="/search?vehicleType=THREE_WHEELER">Three wheelers</Link>
        </nav>

        <nav className="site-footer__col" aria-label="By price">
          <h3>By price</h3>
          <Link to="/search?maxPrice=1500000">Under Rs 1.5M</Link>
          <Link to="/search?maxPrice=5000000">Under Rs 5M</Link>
          <Link to="/search?minPrice=5000000&maxPrice=15000000">Rs 5M – 15M</Link>
          <Link to="/search?minPrice=15000000">Rs 15M and above</Link>
          <Link to="/search?isNegotiable=true">Negotiable only</Link>
        </nav>

        <nav className="site-footer__col" aria-label="Dealers">
          <h3>Dealers</h3>
          <Link to="/dealer/register">Register as dealer</Link>
          <Link to="/dealer/login">Dealer login</Link>
          <Link to="/search?verifiedDealersOnly=true">Verified dealer listings</Link>
        </nav>
      </div>

      <div className="site-footer__bar">
        <span>© {new Date().getFullYear()} AutoVaultLK</span>
        <span className="site-footer__note">
          A university project build — listings and dealers are seeded sample data.
        </span>
      </div>
    </footer>
  )
}
