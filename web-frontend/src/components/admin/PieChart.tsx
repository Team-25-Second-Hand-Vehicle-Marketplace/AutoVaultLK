import { useState } from 'react'

/**
 * Part-to-whole at a glance — capped at 6 slices (dataviz's own rule: past
 * that, adjacent segments blur and a table reads better). These are true
 * categorical identity colors, not the app's reserved --success/--accent/
 * --danger status tokens: a status color is deliberately reused across
 * unrelated statuses elsewhere in this admin (BarRow's LISTING_STATUS_COLOR
 * maps two different statuses to the same --accent, safe there because a
 * text label sits right next to every bar). A pie has no such label next to
 * each mark — color is the only thing separating one slice from its
 * neighbor — so two same-colored slices here would be genuinely ambiguous,
 * not just inconsistent. This uses the dataviz skill's own validated 8-hue
 * categorical order instead, fixed order, never cycled; slots 1–6 pass every
 * adjacent-pair CVD/contrast check in light mode (this app has no dark admin
 * theme) per references/palette.md — see validate_palette.js's output for
 * the six-slot cut used here.
 */
const CATEGORICAL_SLOTS = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
]

const SIZE = 160
const CENTER = SIZE / 2
const RADIUS = SIZE / 2 - 4

export function PieChart({
  data,
  emptyMessage = 'No data in this window.',
}: {
  data: { label: string; value: number }[]
  emptyMessage?: string
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Folds a 7th+ category into "Other" rather than generating a 7th hue —
  // a generated color is indistinguishable from an existing one under CVD.
  const capped = data.filter((d) => d.value > 0)
  const slices =
    capped.length <= CATEGORICAL_SLOTS.length
      ? capped
      : [
          ...capped
            .slice()
            .sort((a, b) => b.value - a.value)
            .slice(0, CATEGORICAL_SLOTS.length - 1),
          {
            label: 'Other',
            value: capped
              .slice()
              .sort((a, b) => b.value - a.value)
              .slice(CATEGORICAL_SLOTS.length - 1)
              .reduce((sum, d) => sum + d.value, 0),
          },
        ]

  const total = slices.reduce((sum, s) => sum + s.value, 0)

  if (total === 0) {
    return (
      <div className="pie-chart pie-chart--empty">
        <p className="admin-muted">{emptyMessage}</p>
      </div>
    )
  }

  let cursor = -Math.PI / 2 // 12 o'clock start, clockwise.
  const arcs = slices.map((slice, i) => {
    const fraction = slice.value / total
    const start = cursor
    const end = cursor + fraction * Math.PI * 2
    cursor = end
    return { ...slice, start, end, fraction, color: CATEGORICAL_SLOTS[i] }
  })

  return (
    <div className="pie-chart">
      <svg
        className="pie-chart__svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${slices.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(', ')}`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {arcs.map((arc, i) => (
          <path
            key={arc.label}
            d={arcPath(arc.start, arc.end)}
            fill={arc.color}
            className="pie-chart__slice"
            opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.45}
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}
      </svg>

      <ul className="pie-chart__legend">
        {arcs.map((arc, i) => (
          <li
            key={arc.label}
            className="pie-chart__legend-item"
            onMouseEnter={() => setHoverIndex(i)}
            onMouseLeave={() => setHoverIndex(null)}
          >
            <span className="pie-chart__swatch" style={{ background: arc.color }} aria-hidden="true" />
            <span className="pie-chart__legend-label">{arc.label.replace(/_/g, ' ')}</span>
            <span className="pie-chart__legend-value">
              {arc.value.toLocaleString('en-LK')} · {Math.round(arc.fraction * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function arcPath(startAngle: number, endAngle: number): string {
  // A full circle (one slice = 100%) can't be drawn as a single SVG arc
  // (start and end points coincide), so pull it in fractionally.
  const isFullCircle = endAngle - startAngle >= Math.PI * 2 - 0.0001
  const end = isFullCircle ? startAngle + Math.PI * 2 - 0.0001 : endAngle

  const [x1, y1] = pointOnCircle(startAngle)
  const [x2, y2] = pointOnCircle(end)
  const largeArc = end - startAngle > Math.PI ? 1 : 0

  return `M ${CENTER} ${CENTER} L ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${x2} ${y2} Z`
}

function pointOnCircle(angle: number): [number, number] {
  return [CENTER + RADIUS * Math.cos(angle), CENTER + RADIUS * Math.sin(angle)]
}
