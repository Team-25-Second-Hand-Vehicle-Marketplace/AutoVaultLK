import { Car, ShieldCheck, Store, Tags } from 'lucide-react'
import type { MarketplaceStats } from '../../api/search.types'
import { CountUp } from './CountUp'
import { Reveal } from './Reveal'

export function StatsBand({ stats }: { stats: MarketplaceStats | null }) {
  const items = [
    { icon: Car, label: 'Vehicles for sale', value: stats?.vehicleCount },
    { icon: Store, label: 'Dealers on the platform', value: stats?.dealerCount },
    { icon: ShieldCheck, label: 'Verified dealers', value: stats?.verifiedDealerCount },
    { icon: Tags, label: 'Makes to choose from', value: stats?.makeCount },
  ]

  return (
    <section className="nx-section">
      <div className="nx-wrap">
        <Reveal className="nx-section__head">
          <div>
            <p className="nx-kicker">By the numbers</p>
            <h2 className="nx-h2">A marketplace that's actually moving.</h2>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="nx-stats">
            {items.map(({ icon: Icon, label, value }) => (
              <div key={label} className="nx-stats__item">
                <span className="nx-stats__icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <b>{value === undefined ? '-' : <CountUp value={value} />}</b>
                <span className="nx-stats__label">{label}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
