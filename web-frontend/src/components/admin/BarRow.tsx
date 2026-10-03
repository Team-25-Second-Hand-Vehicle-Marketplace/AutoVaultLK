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
