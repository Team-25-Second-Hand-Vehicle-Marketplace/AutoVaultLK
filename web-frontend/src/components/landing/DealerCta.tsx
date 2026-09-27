import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { SlotImage } from '../ui/SlotImage'
import { Reveal } from './Reveal'

export function DealerCta() {
  return (
    <section className="nx-section">
      <div className="nx-wrap">
        <Reveal>
          <div className="nx-cta">
            <SlotImage slot="cta-dealer" className="nx-cta__img" />
            <div className="nx-cta__shade" />
            <div className="nx-cta__body">
              <p className="nx-kicker nx-kicker--light">For dealers and sellers</p>
              <h2>Ready to sell your vehicle?</h2>
              <p>
                Join the dealers already listing on AutoVaultLK. Registration takes a few minutes,
                and your listings go in front of buyers who search the way they talk.
              </p>
              <div className="nx-cta__actions">
                <Link to="/dealer/register" className="nx-btn nx-btn--gold nx-btn--lg">
                  Register as dealer <ArrowUpRight size={18} />
                </Link>
                <Link to="/dealer/login" className="nx-btn nx-btn--glass nx-btn--lg">
                  Dealer login
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
