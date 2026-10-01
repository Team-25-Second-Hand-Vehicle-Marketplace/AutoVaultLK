import { useId, useMemo, useState } from 'react'
import type { TimeSeriesPoint } from '../../api/admin.types'

/**
 * A daily count over time - one line, one hue (`colorVar`, one of the app's
 * own reserved tokens, same convention as BarRow). Straight segments, not a
 * smoothed curve: a curve between two real daily counts implies values that
 * were never measured, which is dishonest for a count that can only ever be
 * a whole number on a whole day.
 *
 * No axis library, no dependency - this is a handful of SVG paths, matching
 * BarRow/PieChart's own hand-rolled approach elsewhere in this admin surface.
 */

const WIDTH = 600
const HEIGHT = 160
const PAD_TOP = 12
const PAD_BOTTOM = 24
const PAD_X = 4

export function LineChart({
  points,
  colorVar = '--accent',
  emptyMessage = 'No activity in this window.',
}: {
  points: TimeSeriesPoint[]
  colorVar?: string
  emptyMessage?: string
}) {
  const gradientId = useId()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const total = points.reduce((sum, p) => sum + p.count, 0)
  const max = Math.max(1, ...points.map((p) => p.count))

  const plotWidth = WIDTH - PAD_X * 2
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM

  const xFor = (i: number) =>
    points.length <= 1 ? PAD_X : PAD_X + (i / (points.length - 1)) * plotWidth
  const yFor = (count: number) => PAD_TOP + plotHeight - (count / max) * plotHeight

  const linePath = useMemo(
    () => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.count)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, max],
  )

  const areaPath = useMemo(() => {
    if (points.length === 0) return ''
    const baseline = PAD_TOP + plotHeight
    return `${linePath} L ${xFor(points.length - 1)} ${baseline} L ${xFor(0)} ${baseline} Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linePath, points.length])

  if (points.length === 0 || total === 0) {
    return (
      <div className="line-chart line-chart--empty">
        <p className="admin-muted">{emptyMessage}</p>
      </div>
    )
  }

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const index = Math.round(ratio * (points.length - 1))
    setHoverIndex(Math.min(points.length - 1, Math.max(0, index)))
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null
  const last = points[points.length - 1]
  // Sparse ticks: first, middle, last - 30 daily labels on one axis would be
  // unreadable clutter, and the tooltip already gives an exact date on hover.
  const tickIndexes = Array.from(
    new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  )

  return (
    <div className="line-chart">
      <div className="line-chart__head">
        <span className="line-chart__max">
          Peak {max.toLocaleString('en-LK')}/day
        </span>
        <span className="line-chart__total">{total.toLocaleString('en-LK')} total</span>
      </div>

      <svg
        className="line-chart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Daily counts, peak ${max} per day, ${total} total over the period`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(${colorVar})`} stopOpacity="0.22" />
            <stop offset="100%" stopColor={`var(${colorVar})`} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Baseline only - a full grid would compete with a 30-point line for attention. */}
        <line
          x1={PAD_X}
          y1={PAD_TOP + plotHeight}
          x2={WIDTH - PAD_X}
          y2={PAD_TOP + plotHeight}
          className="line-chart__baseline"
        />

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={`var(${colorVar})`} strokeWidth={2} />

        {/* Emphasized endpoint: the latest day is the number an admin actually wants at a glance. */}
        <circle cx={xFor(points.length - 1)} cy={yFor(last.count)} r={4} fill={`var(${colorVar})`} />

        {hovered && hoverIndex !== null && (
          <g>
            <line
              x1={xFor(hoverIndex)}
              y1={PAD_TOP}
              x2={xFor(hoverIndex)}
              y2={PAD_TOP + plotHeight}
              className="line-chart__crosshair"
            />
            <circle
              cx={xFor(hoverIndex)}
              cy={yFor(hovered.count)}
              r={4}
              fill="var(--bg)"
              stroke={`var(${colorVar})`}
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      <div className="line-chart__ticks">
        {tickIndexes.map((i) => (
          <span key={i} className="line-chart__tick">
            {formatTick(points[i].date)}
          </span>
        ))}
      </div>

      {hovered && (
        <div className="line-chart__tooltip" role="status">
          <strong>{hovered.count.toLocaleString('en-LK')}</strong>
          <span>{formatTick(hovered.date)}</span>
        </div>
      )}
    </div>
  )
}

function formatTick(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  return `${monthNames[Number(month) - 1]} ${Number(day)}`
}
