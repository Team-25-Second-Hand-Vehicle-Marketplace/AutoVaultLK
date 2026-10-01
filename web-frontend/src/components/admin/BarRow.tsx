/**
 * One row of a horizontal bar list: a label, a bar sized against the group's
 * own max (never against an absolute scale - these are small counts, and a
 * bar scaled 0–1000 would render every real value as a sliver), and the
 * value at the bar's tip rather than inside it (these counts are often too
 * small for the bar to comfortably hold a label without clipping).
 *
 * `colorVar` takes a CSS custom property name (e.g. "--success"), not a raw
 * hex - every color here is one of the app's own reserved tokens, the same
 * ones the status Pill already uses, not a new palette invented for this
 * chart.
 */
export function BarRow({
  label,
  value,
  max,
  colorVar,
}: {
  label: string
  value: number
  max: number
  colorVar: string
}) {
  // A 0-width bar for an all-zero group reads as "broken", not "empty" - a
  // hairline placeholder is honest about there being a real, if tiny, share.
  const pct = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0

  return (
    <div className="bar-row">
      <span className="bar-row__label">{label}</span>
      <div className="bar-row__track">
        <div
          className="bar-row__fill"
          style={{ width: `${pct}%`, background: `var(${colorVar})` }}
        />
      </div>
      <span className="bar-row__value">{value.toLocaleString('en-LK')}</span>
    </div>
  )
}
