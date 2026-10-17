import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-slate-950 font-bold hover:bg-accent-strong active:bg-accent-strong shadow-sm hover:shadow-accent/30 active:scale-[0.99] transition-all disabled:hover:shadow-none disabled:active:scale-100',
  secondary:
    'border border-line-strong bg-surface text-ink font-medium hover:bg-line/25 hover:border-muted/50 active:bg-line/40 transition-colors',
  ghost: 'text-ink-soft hover:text-ink hover:bg-surface-muted active:bg-line/30 transition-colors',
  danger: 'bg-danger text-white font-semibold hover:brightness-110 active:brightness-95 shadow-sm transition-all',
  dangerOutline: 'border border-danger/40 text-danger bg-surface hover:bg-danger/10 transition-colors',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Rendered before the label (replaced by a spinner while loading). */
  icon?: ReactNode
  block?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    block = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})
