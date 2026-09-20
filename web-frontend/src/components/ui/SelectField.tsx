import { forwardRef, useId, type SelectHTMLAttributes } from 'react'

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  /** react-hook-form's errors.<field>?.message, or undefined when valid. */
  error?: string
  options: readonly string[]
  /** Shown as a disabled first option when the field is optional. */
  placeholder?: string
  /** Turns an enum value into something readable — e.g. SEMI_AUTOMATIC. */
  format?: (value: string) => string
}

/**
 * The select counterpart to `FormField`, sharing its markup and error wiring so
 * a form can mix the two without the labels drifting apart.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, error, options, placeholder, format, id, ...rest }, ref) => {
    const autoId = useId()
    const errorId = `${id ?? autoId}-error`

    return (
      <label className="form-field">
        <span>{label}</span>
        <select
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        >
          {placeholder && (
            <option value="">{placeholder}</option>
          )}
          {options.map((option) => (
            <option key={option} value={option}>
              {format ? format(option) : option}
            </option>
          ))}
        </select>
        {error && (
          <span className="form-error" id={errorId}>
            {error}
          </span>
        )}
      </label>
    )
  },
)

SelectField.displayName = 'SelectField'
