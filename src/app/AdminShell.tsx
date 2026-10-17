import { NavLink, Navigate, Outlet } from 'react-router'
import type { ReactNode } from 'react'
import {
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShoppingCart,
  Users,
  UsersRound,
} from 'lucide-react'
import { useAdminAuth } from '@/auth/AdminAuthProvider'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { ConnectionBadge } from '@/app/ConnectionBadge'
import { CreateEventPanel } from '@/features/events/CreateEventPanel'
import { LoadingBlock } from '@/components/ui/Feedback'
import { cn } from '@/lib/cn'

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/purchases/new', label: 'Record purchase', icon: ShoppingCart },
  { to: '/admin/players', label: 'Players', icon: Users },
  { to: '/admin/teams', label: 'Teams', icon: UsersRound },
  { to: '/admin/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
] as const

function navClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'relative flex shrink-0 items-center gap-2 px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-all',
    isActive
      ? 'text-white after:absolute after:bottom-0 after:left-1 after:right-1 after:h-[2px] after:rounded-full after:bg-accent after:shadow-[0_0_10px_rgba(230,0,110,0.8)]'
      : 'text-ink-muted hover:text-ink hover:bg-surface-muted/40 rounded-lg',
  )
}

export function AdminShell() {
  const auth = useAdminAuth()
  const { event, eventId, loading, error, fromCache } = useAdminEvent()

  if (loading && !event && !error) {
    return <LoadingBlock label="Loading event…" />
  }

  if (!event) {
    if (loading || error) {
      return <LoadingBlock label="Loading event…" />
    }
    return <CreateEventPanel />
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-x-4 px-4 py-2.5 sm:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            {!event.purchasesEnabled && event.status === 'active' ? (
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                paused
              </span>
            ) : null}
          </div>

          <nav className="flex items-center gap-1 overflow-x-auto py-0.5" aria-label="Admin sections">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={navClass}>
                <item.icon className="size-3.5" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <ConnectionBadge fromCache={fromCache} loading={loading} error={error} />
            <button
              type="button"
              onClick={() => void auth.signOut()}
              className="text-xs font-semibold text-ink-muted transition-colors hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet context={{ eventId }} />
      </main>
    </div>
  )
}

/** Blocks the console until an admin (custom claim) is signed in. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAdminAuth()
  if (auth.status === 'loading') return <LoadingBlock label="Checking access…" />
  if (auth.status === 'signedOut') return <Navigate to="/admin/login" replace />
  if (auth.status === 'notAuthorized') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
        <div className="rounded-card border border-line bg-surface p-6 text-center shadow-card">
          <h1 className="text-lg font-semibold text-ink">Not an auction admin</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This session is signed in but does not have admin access to this auction.
          </p>
          <p className="mt-1 text-xs text-muted">
            Sign out and sign in with the organizer credentials for this deployment.
          </p>
          <button
            type="button"
            onClick={() => void auth.signOut()}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-xl bg-accent px-5 text-sm font-bold text-white shadow-[0_0_15px_rgba(230,0,110,0.35)] transition-all hover:bg-accent-light active:scale-[0.98]"
          >
            Sign out
          </button>
        </div>
      </main>
    )
  }
  return <>{children}</>
}
