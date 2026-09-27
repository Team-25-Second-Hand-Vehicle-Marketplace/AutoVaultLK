import type { MarketplaceStats } from '../../api/search.types'
import { CountUp } from './CountUp'
import { Reveal } from './Reveal'

export function StatsBand({ stats }: { stats: MarketplaceStats | null }) {
  const items = [
    { label: 'Vehicles for sale', value: stats?.vehicleCount },
    { label: 'Dealers on the platform', value: stats?.dealerCount },
    { label: 'Verified dealers', value: stats?.verifiedDealerCount },
    { label: 'Makes to choose from', value: stats?.makeCount },
  ]

  return (
    <section className="nx-section nx-section--tight">
      <div className="nx-wrap">
        <Reveal>
          <div className="nx-stats">
            {items.map((item) => (
              <div key={item.label} className="nx-stats__item">
                <b>{item.value === undefined ? '—' : <CountUp value={item.value} />}</b>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
