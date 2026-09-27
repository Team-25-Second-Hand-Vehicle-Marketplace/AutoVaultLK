import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ArrowRight, Search } from 'lucide-react'
import { filterSearch, getSearchOptions } from '../../api/search.api'
import type { MakeOption } from '../../api/search.types'

/** Price ceilings, in LKR. Spans the range of vehicles on the site. */
const PRICE_STEPS = [
  1_000_000, 2_500_000, 5_000_000, 7_500_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000,
]

const nf = new Intl.NumberFormat('en-LK')

const compactLkr = (value: number) =>
  `LKR ${(value / 1_000_000).toLocaleString('en-LK', { maximumFractionDigits: 1 })}M`

/**
 * The hero's search bar: plain-English query, or narrow by make and budget.
 * Shows a live match count on the button from the same endpoints as before
 * (getSearchOptions for makes, filterSearch for the count).
 */
export function HeroSearch() {
  const navigate = useNavigate()
  const [makes, setMakes] = useState<MakeOption[]>([])
  const [query, setQuery] = useState('')
  const [make, setMake] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getSearchOptions(undefined, controller.signal)
      .then((res) => setMakes(res.makes))
      .catch((err) => {
        if (!axios.isCancel(err)) console.error('Failed to load makes:', err)
      })
    return () => controller.abort()
  }, [])

  // A typed query is a natural-language search, which the count endpoint
  // cannot answer, so the live count only tracks the structured filters.
  const filtersOnly = query.trim() === ''

  useEffect(() => {
    if (!filtersOnly) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      filterSearch(
        {
          limit: 1,
          make: make ? [make] : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
        },
        controller.signal,
      )
        .then((res) => setCount(res.total))
        .catch((err) => {
          if (!axios.isCancel(err)) console.error('Failed to count matches:', err)
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [make, maxPrice, filtersOnly])

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (query.trim()) p.set('q', query.trim())
    if (make) p.set('make', make)
    if (maxPrice) p.set('maxPrice', maxPrice)
    return p.toString()
  }, [query, make, maxPrice])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(params ? `/search?${params}` : '/search')
  }

  return (
    <form className="nx-hsearch" onSubmit={submit} role="search">
      <label className="nx-hsearch__query">
        <Search size={18} aria-hidden="true" />
        <input
          type="text"
          placeholder="Try “red Toyata Aqua under 6 million”…"
          aria-label="Describe the vehicle you want"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <label className="nx-hsearch__field">
        <span>Make</span>
        <select value={make} onChange={(e) => setMake(e.target.value)}>
          <option value="">Any</option>
          {makes.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="nx-hsearch__field">
        <span>Budget</span>
        <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}>
          <option value="">Any</option>
          {PRICE_STEPS.map((p) => (
            <option key={p} value={p}>
              Up to {compactLkr(p)}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="nx-btn nx-btn--light nx-hsearch__go">
        {filtersOnly && count !== null ? `Show ${nf.format(count)}` : 'Search'}
        <ArrowRight size={16} />
      </button>
    </form>
  )
}
