import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { MarketplaceStats } from '../../api/search.types'
import type { ImageSlotId } from '../../assets/image-slots'
import { SlotImage } from '../ui/SlotImage'
import { VehicleTypeIcon } from '../ui/VehicleTypeIcon'
import { Reveal } from './Reveal'

interface Group {
  /** Title on the tile. */
  label: string
  /** Icon to draw (a VehicleTypeValue). */
  icon: string
  slot: ImageSlotId
  /** Backend vehicle types this tile covers; the tile's count is their sum. */
  types: string[]
  hint?: string
}

/**
 * The tiles, in a fixed order so the grid never reshuffles as counts change.
 * "Other" gathers the types too small to deserve a tile of their own.
 */
const GROUPS: Group[] = [
  { label: 'Cars', icon: 'CAR', slot: 'cat-car', types: ['CAR'] },
  { label: 'SUVs', icon: 'SUV', slot: 'cat-suv', types: ['SUV'] },
  { label: 'Bikes', icon: 'BIKE', slot: 'cat-bike', types: ['BIKE'] },
  { label: 'Vans', icon: 'VAN', slot: 'cat-van', types: ['VAN'] },
  { label: 'Three wheelers', icon: 'THREE_WHEELER', slot: 'cat-three-wheeler', types: ['THREE_WHEELER'] },
  { label: 'Pickups', icon: 'PICKUP', slot: 'cat-pickup', types: ['PICKUP'] },
  { label: 'Lorries & trucks', icon: 'LORRY', slot: 'cat-lorry', types: ['LORRY', 'TRUCK'] },
  {
    label: 'Other',
    icon: 'TRACTOR',
    slot: 'cat-other',
    types: ['TRACTOR', 'BUS', 'HEAVY_MACHINERY'],
    hint: 'Tractors, buses & machinery',
  },
]

const nf = new Intl.NumberFormat('en-LK')

export function CategoryBento({
  categories,
}: {
  categories: MarketplaceStats['categories'] | undefined
}) {
  const counts = new Map((categories ?? []).map((c) => [c.vehicleType as string, c.count]))

  return (
    <section className="nx-section">
      <div className="nx-wrap">
        <Reveal className="nx-section__head">
          <div>
            <p className="nx-kicker">Browse by type</p>
            <h2 className="nx-h2">Whatever you drive, it&apos;s here.</h2>
          </div>
        </Reveal>

        <div className="nx-bento">
          {GROUPS.map((group, i) => {
            // null until the stats arrive, so a tile never claims "0 listed"
            // just because the request is still in flight.
            const count = categories
              ? group.types.reduce((sum, t) => sum + (counts.get(t) ?? 0), 0)
              : null

            return (
              <Reveal key={group.label} delay={i * 0.05} className={`nx-bento__cell nx-bento__cell--${i}`}>
                <Link to={`/search?vehicleType=${group.types.join(',')}`} className="nx-tile">
                  <SlotImage slot={group.slot} className="nx-tile__img" />
                  <div className="nx-tile__shade" />
                  <span className="nx-tile__icon" aria-hidden="true">
                    <VehicleTypeIcon type={group.icon} size={24} />
                  </span>
                  <div className="nx-tile__text">
                    <span className="nx-tile__count">
                      {count ? `${nf.format(count)} listed` : (group.hint ?? 'Browse')}
                    </span>
                    <h3>{group.label}</h3>
                  </div>
                  <span className="nx-tile__arrow" aria-hidden="true">
                    <ArrowUpRight size={20} />
                  </span>
                </Link>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
