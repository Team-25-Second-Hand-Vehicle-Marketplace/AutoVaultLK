import { useState, type FormEvent } from 'react'
import { getReports } from '../../api/admin.api'
import type { AdminReports } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'

function defaultRange(): { from: string; to: string } {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function toStartIso(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString()
}

function toEndIso(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString()
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

export function AdminReportsPage() {
  const initial = defaultRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [data, setData] = useState<AdminReports | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const report = await getReports(toStartIso(from), toEndIso(to))
      setData(report)
    } catch (err) {
      setData(null)
      setError(toErrorMessage(err, 'Could not load report.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page__header">
        <h1>Reports</h1>
        <p>Summary metrics over a date range.</p>
      </header>

      <form className="admin-toolbar" onSubmit={(e) => void onSubmit(e)}>
        <label className="admin-toolbar__field">
          <span>From</span>
          <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="admin-toolbar__field">
          <span>To</span>
          <input type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Run report'}
        </Button>
      </form>

      <ErrorBanner message={error} />

      {data && (
        <div className="admin-tiles">
          <div className="admin-tiles__item">
            <span className="admin-tiles__label">Active users created</span>
            <strong className="admin-tiles__value">{data.activeUsers}</strong>
          </div>
          <div className="admin-tiles__item">
            <span className="admin-tiles__label">Upload jobs</span>
            <strong className="admin-tiles__value">{data.uploads.jobs}</strong>
            <span className="admin-tiles__hint">
              {data.uploads.validRecords} valid · {data.uploads.invalidRecords} invalid of{' '}
              {data.uploads.totalRecords} records
            </span>
          </div>
          <div className="admin-tiles__item">
            <span className="admin-tiles__label">Job error rate</span>
            <strong className="admin-tiles__value">{pct(data.jobRates.errorRate)}</strong>
          </div>
          <div className="admin-tiles__item">
            <span className="admin-tiles__label">Job partial rate</span>
            <strong className="admin-tiles__value">{pct(data.jobRates.partialRate)}</strong>
          </div>
          {Object.entries(data.listings).map(([status, count]) => (
            <div key={status} className="admin-tiles__item">
              <span className="admin-tiles__label">Listings · {status}</span>
              <strong className="admin-tiles__value">{count}</strong>
            </div>
          ))}
        </div>
      )}

      {!data && !error && !loading && (
        <p className="admin-muted">Choose a range and run a report.</p>
      )}
    </div>
  )
}
