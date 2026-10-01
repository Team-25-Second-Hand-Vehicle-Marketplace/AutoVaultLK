import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { BrandMark } from './BrandMark'

export function Footer() {
  return (
    <footer className="nx-footer">
      <div className="nx-footer__cta">
        <h2>
          Your next vehicle is
          <br />
          <em>one search away.</em>
        </h2>
        <Link to="/search" className="nx-btn nx-btn--light nx-btn--lg">
          Browse all vehicles <ArrowUpRight size={18} />
        </Link>
      </div>

      <div className="nx-footer__grid">
        <div className="nx-footer__brand">
          <BrandMark />
          <p>
            Sri Lanka&apos;s second-hand vehicle marketplace. Real listings from verified
            dealers, and search that understands how people actually talk.
          </p>
        </div>

        <nav aria-label="Browse">
          <h3>Browse</h3>
          <Link to="/search">All vehicles</Link>
          <Link to="/search?vehicleType=CAR">Cars</Link>
          <Link to="/search?vehicleType=SUV">SUVs</Link>
          <Link to="/search?vehicleType=BIKE">Bikes</Link>
          <Link to="/search?vehicleType=THREE_WHEELER">Three wheelers</Link>
        </nav>

        <nav aria-label="By price">
          <h3>By price</h3>
          <Link to="/search?maxPrice=1500000">Under Rs 1.5M</Link>
          <Link to="/search?maxPrice=5000000">Under Rs 5M</Link>
          <Link to="/search?minPrice=5000000&maxPrice=15000000">Rs 5M – 15M</Link>
          <Link to="/search?minPrice=15000000">Rs 15M and above</Link>
          <Link to="/search?isNegotiable=true">Negotiable only</Link>
        </nav>

        <nav aria-label="Dealers">
          <h3>Dealers</h3>
          <Link to="/dealer/register">Register as dealer</Link>
          <Link to="/dealer/login">Dealer login</Link>
          <Link to="/search?verifiedDealersOnly=true">Verified dealer listings</Link>
        </nav>

        <nav aria-label="Support">
          <h3>Support</h3>
          <a href="mailto:autovaultlk@gmail.com">autovaultlk@gmail.com</a>
          <a href="tel:+94770308165">077 030 8165</a>
        </nav>
      </div>

      <div className="nx-footer__bar">
        <span>© {new Date().getFullYear()} AutoVaultLK</span>
        <span>Made in Sri Lanka.</span>
      </div>
    </footer>
  )
}
