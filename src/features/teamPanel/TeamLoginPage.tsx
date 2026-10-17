import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { Delete, KeyRound, ShieldCheck } from 'lucide-react'
import { useTeamAuth } from '@/auth/TeamAuthProvider'
import { usePublicConfig } from '@/data/hooks'
import { isCallError } from '@/services/callables'
import { errorMessage, type FriendlyError } from '@/lib/errors'
import { Card, CardBody } from '@/components/ui/Card'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function TeamLoginPage() {
  const auth = useTeamAuth()
  const config = usePublicConfig()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  const cooldownRemaining = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0

  useEffect(() => {
    if (!cooldownUntil) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  useEffect(() => {
    if (cooldownUntil && cooldownRemaining <= 0) setCooldownUntil(null)
  }, [cooldownUntil, cooldownRemaining])

  if (auth.status === 'signedIn') return <Navigate to="/team" replace />

  async function submit(nextPin: string): Promise<void> {
    if (nextPin.length !== 4 || submitting || cooldownRemaining > 0) return
    setSubmitting(true)
    setError(null)
    setHint(null)
    try {
      await auth.signIn(nextPin)
    } catch (caught) {
      const friendly: FriendlyError = isCallError(caught)
        ? caught
        : { message: errorMessage(caught), code: 'unknown', retryable: true }
      setError(friendly.message)
      if (friendly.hint) setHint(friendly.hint)
      if (friendly.retryAfterSeconds && friendly.retryAfterSeconds > 0) {
        setNow(Date.now())
        setCooldownUntil(Date.now() + friendly.retryAfterSeconds * 1000)
      }
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  function press(key: string): void {
    if (submitting || cooldownRemaining > 0) return
    const next = (pin + key).slice(0, 4)
    setPin(next)
    if (next.length === 4) void submit(next)
  }

  function backspace(): void {
    if (submitting) return
    setPin((current) => current.slice(0, -1))
  }

  const eventName = config.data?.eventName || 'the auction'

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-charcoal text-white">
          <KeyRound className="size-5" aria-hidden />
        </span>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Team login</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">{eventName}</h1>
        <p className="mt-1 text-sm text-muted">Enter the four-digit PIN from your organizer.</p>
      </div>

      <Card>
        <CardBody className="space-y-4">
          {auth.sessionMessage ? (
            <p role="status" className="rounded-control border border-warn/25 bg-warn-soft px-3 py-2 text-xs text-warn">
              {auth.sessionMessage}
            </p>
          ) : null}

          <div className="flex justify-center gap-3" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={
                  index < pin.length
                    ? 'flex size-12 items-center justify-center rounded-control border-2 border-accent bg-accent-soft text-xl font-bold text-accent'
                    : 'flex size-12 items-center justify-center rounded-control border-2 border-line bg-surface text-xl font-bold text-muted'
                }
              >
                {index < pin.length ? '•' : ''}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                disabled={submitting || cooldownRemaining > 0}
                onClick={() => press(key)}
                className="h-12 rounded-control border border-line bg-surface text-lg font-semibold text-ink transition-colors hover:bg-surface-muted active:bg-line/40 disabled:opacity-40"
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              disabled={submitting || cooldownRemaining > 0}
              onClick={() => setPin('')}
              className="h-12 rounded-control border border-line bg-surface text-sm font-medium text-muted transition-colors hover:bg-surface-muted active:bg-line/40 disabled:opacity-40"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={submitting || cooldownRemaining > 0}
              onClick={() => press('0')}
              className="h-12 rounded-control border border-line bg-surface text-lg font-semibold text-ink transition-colors hover:bg-surface-muted active:bg-line/40 disabled:opacity-40"
            >
              0
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={backspace}
              aria-label="Delete last digit"
              className="flex h-12 items-center justify-center rounded-control border border-line bg-surface text-muted transition-colors hover:bg-surface-muted active:bg-line/40 disabled:opacity-40"
            >
              <Delete className="size-4" aria-hidden />
            </button>
          </div>

          {submitting ? (
            <p className="text-center text-xs text-muted" role="status">
              Checking…
            </p>
          ) : null}
          {cooldownRemaining > 0 ? (
            <p className="text-center text-xs text-warn" role="alert">
              Too many attempts. Try again in {cooldownRemaining} second{cooldownRemaining === 1 ? '' : 's'}.
            </p>
          ) : null}
          {error && cooldownRemaining <= 0 ? (
            <div className="rounded-control bg-danger-soft px-3 py-2 text-center" role="alert">
              <p className="text-sm text-danger">{error}</p>
              {hint ? <p className="mt-0.5 text-xs text-danger/90">{hint}</p> : null}
            </div>
          ) : null}

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted">
            <ShieldCheck className="size-3.5" aria-hidden />
            Each PIN only opens one team's private page. Nothing else is visible.
          </div>
        </CardBody>
      </Card>

      <p className="mt-5 text-center text-xs text-muted">
        Organizer?{' '}
        <Link to="/admin/login" className="font-medium text-accent hover:underline">
          Admin sign in
        </Link>
      </p>
    </main>
  )
}
