import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { Delete, ShieldCheck } from 'lucide-react'
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
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Team login</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">{eventName}</h1>
        <p className="mt-1 text-sm text-muted">Enter the four-digit PIN from your organizer.</p>
      </div>

      <Card className="border-line-strong bg-surface-elevated/90 p-2 shadow-2xl backdrop-blur-md">
        <CardBody className="space-y-5">
          {auth.sessionMessage ? (
            <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs font-medium text-amber-300">
              {auth.sessionMessage}
            </p>
          ) : null}

          <div className="flex justify-center gap-3.5" aria-hidden>
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={
                  index < pin.length
                    ? 'flex size-12 items-center justify-center rounded-xl border-2 border-accent bg-accent/20 text-2xl font-black text-accent shadow-[0_0_15px_rgba(230,0,110,0.5)] transition-all'
                    : 'flex size-12 items-center justify-center rounded-xl border border-line-strong bg-surface-muted/60 text-xl font-bold text-ink-muted/40 transition-all'
                }
              >
                {index < pin.length ? '•' : ''}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {KEYS.map((key) => (
              <button
                key={key}
                type="button"
                disabled={submitting || cooldownRemaining > 0}
                onClick={() => press(key)}
                className="h-13 rounded-xl border border-line bg-surface-muted/70 text-lg font-bold text-white transition-all hover:border-line-strong hover:bg-surface-muted active:scale-[0.97] active:bg-accent/20 active:border-accent disabled:opacity-30"
              >
                {key}
              </button>
            ))}
            <button
              type="button"
              disabled={submitting || cooldownRemaining > 0}
              onClick={() => setPin('')}
              className="h-13 rounded-xl border border-line bg-surface-muted/50 text-xs font-bold uppercase tracking-wider text-ink-muted transition-all hover:bg-surface-muted active:scale-[0.97] disabled:opacity-30"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={submitting || cooldownRemaining > 0}
              onClick={() => press('0')}
              className="h-13 rounded-xl border border-line bg-surface-muted/70 text-lg font-bold text-white transition-all hover:border-line-strong hover:bg-surface-muted active:scale-[0.97] active:bg-accent/20 active:border-accent disabled:opacity-30"
            >
              0
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={backspace}
              aria-label="Delete last digit"
              className="flex h-13 items-center justify-center rounded-xl border border-line bg-surface-muted/50 text-ink-muted transition-all hover:text-white hover:bg-surface-muted active:scale-[0.97] disabled:opacity-30"
            >
              <Delete className="size-4" aria-hidden />
            </button>
          </div>

          {submitting ? (
            <p className="text-center text-xs font-medium text-accent animate-pulse" role="status">
              Authenticating team…
            </p>
          ) : null}
          {cooldownRemaining > 0 ? (
            <p className="text-center text-xs font-semibold text-amber-400" role="alert">
              Too many attempts. Try again in {cooldownRemaining} second{cooldownRemaining === 1 ? '' : 's'}.
            </p>
          ) : null}
          {error && cooldownRemaining <= 0 ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-center" role="alert">
              <p className="text-sm font-semibold text-rose-300">{error}</p>
              {hint ? <p className="mt-0.5 text-xs text-rose-400/90">{hint}</p> : null}
            </div>
          ) : null}

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-muted">
            <ShieldCheck className="size-3.5 text-accent" aria-hidden />
            Each PIN only opens one team's private page.
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
