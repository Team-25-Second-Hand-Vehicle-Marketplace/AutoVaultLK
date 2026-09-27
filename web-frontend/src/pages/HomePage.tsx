import { useEffect, useState } from 'react'
import axios from 'axios'
import { filterSearch, getMarketplaceStats } from '../api/search.api'
import type { MarketplaceStats, VehicleSearchResult } from '../api/search.types'
import { BrandMarquee } from '../components/landing/BrandMarquee'
import { CategoryBento } from '../components/landing/CategoryBento'
import { DealerCta } from '../components/landing/DealerCta'
import { FeaturedRail } from '../components/landing/FeaturedRail'
import { Hero } from '../components/landing/Hero'
import { StatsBand } from '../components/landing/StatsBand'
import { StoryScroll } from '../components/landing/StoryScroll'

export function HomePage() {
  const [stats, setStats] = useState<MarketplaceStats | null>(null)
  const [featured, setFeatured] = useState<VehicleSearchResult[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    getMarketplaceStats(controller.signal)
      .then(setStats)
      .catch((err) => {
        if (!axios.isCancel(err)) console.error('Failed to load stats:', err)
      })

    filterSearch({ sort: 'newest', limit: 16 }, controller.signal)
      .then((res) => setFeatured(res.items))
      .catch((err) => {
        if (!axios.isCancel(err)) {
          console.error('Failed to load featured vehicles:', err)
          setFeatured([])
        }
      })

    return () => controller.abort()
  }, [])

  return (
    <div className="nx-home">
      <Hero stats={stats} />
      <BrandMarquee makes={stats?.topMakes ?? []} />
      <FeaturedRail items={featured} />
      <CategoryBento categories={stats?.categories} />
      <StoryScroll />
      <StatsBand stats={stats} />
      <DealerCta />
    </div>
  )
}
