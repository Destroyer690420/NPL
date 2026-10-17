import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'

/**
 * Form primitives. Each field renders its own label, optional hint and error
 * text, and wires `aria-invalid` / `aria-describedby` automatically.
 */

const CONTROL_CLASSES =
  'w-full rounded-xl border bg-surface-muted/90 px-3.5 text-sm text-ink placeholder:text-muted/50 ' +
  'transition-colors outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted/30 disabled:text-muted'

function controlClasses(invalid: boolean, size: 'md' | 'lg'): string {
  return cn(
    CONTROL_CLASSES,
    size === 'lg' ? 'h-12' : 'h-10',
    invalid
      ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger'
      : 'border-line-strong focus:border-accent focus:ring-1 focus:ring-accent',
  )
}

interface FieldShellProps {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
  optional?: boolean
}

function FieldShell({ label, htmlFor, hint, error, children, className, optional }: FieldShellProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-soft">
        {label}
        {optional ? <span className="ml-1 font-normal text-muted">(optional)</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: ReactNode
  optional?: boolean
  controlSize?: 'md' | 'lg'
  trailing?: ReactNode
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField(
  { label, hint, error, optional, controlSize = 'md', trailing, className, id, ...rest },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint} error={error} optional={optional} className={className}>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(controlClasses(Boolean(error), controlSize), trailing ? 'pr-10' : null)}
          {...rest}
        />
        {trailing ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">{trailing}</div>
        ) : null}
      </div>
    </FieldShell>
  )
})

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: ReactNode
  error?: ReactNode
  optional?: boolean
}

export const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  function TextareaField({ label, hint, error, optional, className, id, ...rest }, ref) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
    return (
      <FieldShell label={label} htmlFor={inputId} hint={hint} error={error} optional={optional} className={className}>
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            CONTROL_CLASSES,
            'min-h-[76px] py-2',
            error ? 'border-danger focus:border-danger' : 'border-line-strong focus:border-accent',
          )}
          {...rest}
        />
      </FieldShell>
    )
  },
)

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  hint?: ReactNode
  error?: ReactNode
  optional?: boolean
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, optional, className, id, children, ...rest },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint} error={error} optional={optional} className={className}>
      <select
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(controlClasses(Boolean(error), 'md'), 'pr-8')}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  )
})

/** Inline checkbox row with a label. */
export function CheckboxField({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <div>
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
    </div>
  )
}
