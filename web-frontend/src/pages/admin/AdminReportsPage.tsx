import { useCallback, useState, type FormEvent } from 'react'
import { getReports } from '../../api/admin.api'
import type { AdminReports } from '../../api/admin.types'
import { toErrorMessage } from '../../api/client'
import { useAsyncData } from '../../hooks/useAsyncData'
import { Button } from '../../components/ui/Button'
import { ErrorBanner } from '../../components/ui/ErrorBanner'
import { PieChart } from '../../components/admin/PieChart'

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

function formatDateLabel(isoDateOnly: string): string {
  return new Date(`${isoDateOnly}T00:00:00`).toLocaleDateString('en-LK', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

const reportsError = (err: unknown) => toErrorMessage(err, 'Could not load report.')

export function AdminReportsPage() {
  const initial = defaultRange()
  // Draft state (bound to the inputs) is separate from applied state (what's
  // actually fetched) so typing in a date field doesn't refetch on every
  // keystroke — only "Run report" commits a draft into applied.
  const [draftFrom, setDraftFrom] = useState(initial.from)
  const [draftTo, setDraftTo] = useState(initial.to)
  const [appliedFrom, setAppliedFrom] = useState(initial.from)
  const [appliedTo, setAppliedTo] = useState(initial.to)

  // Auto-loads on mount for free: useAsyncData always fetches once on first
  // render, and appliedFrom/appliedTo already hold the default range at that
  // point — no separate "run on mount" code path needed, which is exactly
  // what the old ad-hoc useState-plus-onSubmit version below it was missing.
  const fetchReport = useCallback(
    (signal: AbortSignal) => getReports(toStartIso(appliedFrom), toEndIso(appliedTo), signal),
    [appliedFrom, appliedTo],
  )
  const { data, error, loading } = useAsyncData<AdminReports>(fetchReport, reportsError)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setAppliedFrom(draftFrom)
    setAppliedTo(draftTo)
  }

  // Rates, not counts — uploads.jobs (the one absolute count this DTO gives)
  // recovers real job counts back out of them, the same derivation used for
  // the dashboard's upload-outcome pies, so the pie's legend shows something
  // an admin can act on instead of a raw 0.05 repeating the % beside it.
  const jobOutcomeSlices = data
    ? (() => {
        const jobs = data.uploads.jobs
        const failedJobs = Math.round(data.jobRates.errorRate * jobs)
        const partialJobs = Math.round(data.jobRates.partialRate * jobs)
        const successfulJobs = Math.max(0, jobs - failedJobs - partialJobs)
        return [
          { label: 'Successful', value: successfulJobs },
          { label: 'Partial', value: partialJobs },
          { label: 'Failed', value: failedJobs },
        ]
      })()
    : []

  return (
    <div className="admin-page">
      <header className="admin-page__header no-print">
        <h1>Reports</h1>
        <p>Summary metrics over a date range, formatted to export as a document.</p>
      </header>

      <form className="admin-toolbar no-print" onSubmit={onSubmit}>
        <label className="admin-toolbar__field">
          <span>From</span>
          <input
            type="date"
            required
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
          />
        </label>
        <label className="admin-toolbar__field">
          <span>To</span>
          <input type="date" required value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
        </label>
        <Button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Run report'}
        </Button>
        {data && (
          <Button type="button" variant="ghost" onClick={() => window.print()}>
            Download PDF
          </Button>
        )}
      </form>

      <ErrorBanner message={error} />

      {loading && !data && (
        <p className="admin-muted" role="status">
          Loading report…
        </p>
      )}

      {data && (
        <article className="report-doc">
          <header className="report-doc__header">
            <h2>AutoVault LK — Marketplace Report</h2>
            <p className="admin-muted">
              {formatDateLabel(appliedFrom)} – {formatDateLabel(appliedTo)} · Generated{' '}
              {new Date().toLocaleDateString('en-LK', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </header>

          <div className="admin-kpis report-doc__kpis">
            <div className="admin-kpi">
              <span className="admin-kpi__value">{data.activeUsers.toLocaleString('en-LK')}</span>
              <span className="admin-kpi__label">Active users created</span>
            </div>
            <div className="admin-kpi">
              <span className="admin-kpi__value">{data.uploads.jobs.toLocaleString('en-LK')}</span>
              <span className="admin-kpi__label">Upload jobs run</span>
            </div>
            <div className="admin-kpi">
              <span className="admin-kpi__value">
                {data.uploads.totalRecords.toLocaleString('en-LK')}
              </span>
              <span className="admin-kpi__label">Records processed</span>
            </div>
            <div className="admin-kpi">
              <span className="admin-kpi__value">{pct(data.jobRates.errorRate)}</span>
              <span className="admin-kpi__label">Job error rate</span>
            </div>
            <div className="admin-kpi">
              <span className="admin-kpi__value">{pct(data.jobRates.partialRate)}</span>
              <span className="admin-kpi__label">Job partial rate</span>
            </div>
          </div>

          <div className="admin-grid">
            <section className="admin-card">
              <header className="admin-card__head">
                <h2>Listings by status</h2>
              </header>
              <PieChart
                data={Object.entries(data.listings).map(([label, value]) => ({
                  label: label.replace(/_/g, ' '),
                  value,
                }))}
                emptyMessage="No listings in this range."
              />
            </section>

            <section className="admin-card">
              <header className="admin-card__head">
                <h2>Upload rows accepted</h2>
              </header>
              <PieChart
                data={[
                  { label: 'Valid', value: data.uploads.validRecords },
                  { label: 'Invalid', value: data.uploads.invalidRecords },
                ]}
                colors={['var(--success)', 'var(--danger)']}
                emptyMessage="No rows processed in this range."
              />
            </section>

            <section className="admin-card">
              <header className="admin-card__head">
                <h2>Upload job outcomes</h2>
              </header>
              <PieChart
                data={jobOutcomeSlices}
                colors={['var(--success)', 'var(--warning-text)', 'var(--danger)']}
                emptyMessage="No upload jobs in this range."
              />
            </section>
          </div>
        </article>
      )}

      {!data && !error && !loading && (
        <p className="admin-muted">Choose a range and run a report.</p>
      )}
    </div>
  )
}
