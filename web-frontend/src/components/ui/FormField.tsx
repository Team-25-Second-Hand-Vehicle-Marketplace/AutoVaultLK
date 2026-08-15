import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** react-hook-form's errors.<field>?.message, or undefined when valid. */
  error?: string
}

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, id, ...rest }, ref) => {
    const autoId = useId()
    const errorId = `${id ?? autoId}-error`

    return (
      <label className="form-field">
        <span>{label}</span>
        <input
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
        {error && (
          <span className="form-error" id={errorId}>
            {error}
          </span>
        )}
      </label>
    )
  },
)

FormField.displayName = 'FormField'
