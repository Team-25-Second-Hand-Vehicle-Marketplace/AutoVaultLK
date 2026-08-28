import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** react-hook-form's errors.<field>?.message, or undefined when valid. */
  error?: string
}

/**
 * Wraps the label + input + error-span pattern repeated across every
 * login/register form (see form-field / form-error in app.css). Handles the
 * aria-invalid / aria-describedby wiring that was previously hand-typed at
 * each call site — react-hook-form's register() spreads onto the input via
 * {...rest} exactly as before.
 */
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
