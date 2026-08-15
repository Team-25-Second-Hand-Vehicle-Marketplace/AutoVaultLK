import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  min?: number
  max?: number
  step?: number
  onChange: (min: number | undefined, max: number | undefined) => void
}

export function RangeInput({ label, min, max, step = 1, onChange }: Props) {
  const [localMin, setLocalMin] = useState(min?.toString() ?? '')
  const [localMax, setLocalMax] = useState(max?.toString() ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isTypingRef = useRef(false)

  useEffect(() => {
    if (isTypingRef.current) return
    setLocalMin(min?.toString() ?? '')
    setLocalMax(max?.toString() ?? '')
  }, [min, max])

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const scheduleChange = (nextMin: string, nextMax: string) => {
    isTypingRef.current = true
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange(
        nextMin === '' ? undefined : Number(nextMin),
        nextMax === '' ? undefined : Number(nextMax),
      )
      isTypingRef.current = false
    }, 300)
  }

  return (
    <fieldset className="range-input">
      <legend>{label}</legend>
      <div className="range-input__fields">
        <input
          type="number"
          step={step}
          placeholder="Min"
          value={localMin}
          onChange={(e) => {
            setLocalMin(e.target.value)
            scheduleChange(e.target.value, localMax)
          }}
        />
        <span>–</span>
        <input
          type="number"
          step={step}
          placeholder="Max"
          value={localMax}
          onChange={(e) => {
            setLocalMax(e.target.value)
            scheduleChange(localMin, e.target.value)
          }}
        />
      </div>
    </fieldset>
  )
}
