/**
 * A single ratio against a limit (0–100%), not a bar chart of one bar: the
 * fill's color carries severity (good → warning → critical) and the
 * unfilled track is a lighter step of the *same* ramp as the fill, so the
 * state reads from the whole bar, not just the filled portion.
 */
export function Meter({ ratio, label, hint }: { ratio: number; label: string; hint?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  const severity = ratio >= 0.95 ? 'good' : ratio >= 0.8 ? 'warning' : 'critical'

  return (
    <div className={`meter meter--${severity}`}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value">{pct.toFixed(1)}%</span>
      </div>
      <div className="meter__track">
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
      {hint && <span className="meter__hint">{hint}</span>}
    </div>
  )
}
