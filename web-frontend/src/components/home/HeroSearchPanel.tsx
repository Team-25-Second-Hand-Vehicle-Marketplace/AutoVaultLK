import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { filterSearch, getSearchOptions } from '../../api/search.api'
import type { MakeOption } from '../../api/search.types'
import { Button } from '../ui/Button'


/** Mileage ceilings, in km. Chosen to bracket typical Sri Lankan odometers. */
const MILEAGE_STEPS = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 200_000]

/** Price ceilings, in LKR. Spans the seeded catalogue's real range. */
const PRICE_STEPS = [
  1_000_000, 2_500_000, 5_000_000, 7_500_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000,
]

const CURRENT_YEAR = new Date().getFullYear()
/** Registration-year floors, newest first, back through a 25-year window. */
const YEAR_STEPS = Array.from({ length: 26 }, (_, i) => CURRENT_YEAR - i)

const compactLkr = (value: number) =>
  value >= 1_000_000
    ? `LKR ${(value / 1_000_000).toLocaleString('en-LK', { maximumFractionDigits: 1 })}M`
    : `LKR ${new Intl.NumberFormat('en-LK').format(value)}`

const compactKm = (value: number) =>
  `${new Intl.NumberFormat('en-LK').format(value)} km`

const nf = new Intl.NumberFormat('en-LK')

export function HeroSearchPanel() {
  const navigate = useNavigate()

  const [makes, setMakes] = useState<MakeOption[]>([])
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [maxMileage, setMaxMileage] = useState('')
  const [minYear, setMinYear] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  // null while the first count is in flight, so the button can show a
  // neutral label instead of flashing "0 vehicles" before any data lands.
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

  /** Models for the chosen make. Empty (and the select hidden) until one is picked. */
  const models = useMemo(
    () => (make ? (makes.find((m) => m.name === make)?.models ?? []) : []),
    [makes, make],
  )

  /** The current selection, in the shape both the count query and the URL need. */
  const criteria = useMemo(() => {
    const c: Record<string, string> = {}
    if (make) c.make = make
    if (model) c.model = model
    if (maxMileage) c.maxMileage = maxMileage
    if (minYear) c.minYear = minYear
    if (maxPrice) c.maxPrice = maxPrice
    return c
  }, [make, model, maxMileage, minYear, maxPrice])

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      filterSearch(
        {
          limit: 1,
          make: make ? [make] : undefined,
          model: model ? [model] : undefined,
          maxMileage: maxMileage ? Number(maxMileage) : undefined,
          minYear: minYear ? Number(minYear) : undefined,
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
  }, [make, model, maxMileage, minYear, maxPrice])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const qs = new URLSearchParams(criteria).toString()
    navigate(qs ? `/search?${qs}` : '/search')
  }

  /** Changing make invalidates the model beneath it. */
  const onMakeChange = (next: string) => {
    setMake(next)
    setModel('')
  }

  return (
    <form className="hero-panel" onSubmit={submit}>
      <div className="hero-panel__grid">
        <label className="hero-field hero-field--wide">
          <span className="hero-field__label">Make</span>
          <select value={make} onChange={(e) => onMakeChange(e.target.value)}>
            <option value="">Any make</option>
            {makes.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="hero-field">
          <span className="hero-field__label">Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.length === 0}
          >
            <option value="">{make ? 'Any model' : 'Pick a make first'}</option>
            {models.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="hero-field">
          <span className="hero-field__label">Mileage up to</span>
          <select value={maxMileage} onChange={(e) => setMaxMileage(e.target.value)}>
            <option value="">Any mileage</option>
            {MILEAGE_STEPS.map((km) => (
              <option key={km} value={km}>
                {compactKm(km)}
              </option>
            ))}
          </select>
        </label>

        <label className="hero-field">
          <span className="hero-field__label">Registered from</span>
          <select value={minYear} onChange={(e) => setMinYear(e.target.value)}>
            <option value="">Any year</option>
            {YEAR_STEPS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label className="hero-field">
          <span className="hero-field__label">Price up to</span>
          <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}>
            <option value="">Any price</option>
            {PRICE_STEPS.map((p) => (
              <option key={p} value={p}>
                {compactLkr(p)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="hero-panel__foot">
        <button
          type="button"
          className="hero-panel__advanced"
          onClick={() => navigate('/search')}
        >
          Advanced search
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>

        <Button type="submit" className="hero-panel__submit">
          {count === null ? 'Search vehicles' : `${nf.format(count)} vehicles`}
        </Button>
      </div>
    </form>
  )
}
