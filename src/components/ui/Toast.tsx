import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastInput {
  kind: ToastKind
  message: string
  detail?: string
  /** Milliseconds before auto-dismiss (0 keeps it until dismissed). */
  durationMs?: number
}

interface ToastEntry extends ToastInput {
  id: number
}

interface ToastContextValue {
  push: (toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside <ToastProvider>.')
  return value
}

const KIND_STYLES: Record<ToastKind, { container: string; icon: ReactNode }> = {
  success: {
    container: 'border-emerald-500/40 bg-surface-elevated/95 backdrop-blur-md shadow-2xl',
    icon: <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />,
  },
  error: {
    container: 'border-rose-500/40 bg-surface-elevated/95 backdrop-blur-md shadow-2xl',
    icon: <AlertTriangle className="size-4 text-rose-400" aria-hidden />,
  },
  info: {
    container: 'border-line-strong bg-surface-elevated/95 backdrop-blur-md shadow-2xl',
    icon: <Info className="size-4 text-accent" aria-hidden />,
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (toast: ToastInput) => {
      const id = nextId.current
      nextId.current += 1
      setToasts((current) => [...current.slice(-3), { ...toast, id }])
      const duration = toast.durationMs ?? (toast.kind === 'error' ? 7000 : 4500)
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration)
        timers.current.set(id, timer)
      }
    },
    [dismiss],
  )

  useEffect(() => {
    const active = timers.current
    return () => {
      for (const timer of active.values()) window.clearTimeout(timer)
      active.clear()
    }
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const styles = KIND_STYLES[toast.kind]
          return (
            <div
              key={toast.id}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border px-4 py-3 shadow-card',
                styles.container,
              )}
            >
              <span className="mt-0.5 shrink-0">{styles.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{toast.message}</p>
                {toast.detail ? <p className="mt-0.5 text-xs text-muted">{toast.detail}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="rounded-md p-1 text-muted transition-colors hover:bg-line/40 hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
