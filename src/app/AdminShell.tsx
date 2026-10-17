import { NavLink, Navigate, Outlet } from 'react-router'
import { useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  UsersRound,
} from 'lucide-react'
import { useAdminAuth, isUsingDefaultAdminCredentials } from '@/auth/AdminAuthProvider'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { ConnectionBadge } from '@/app/ConnectionBadge'
import { CreateEventPanel } from '@/features/events/CreateEventPanel'
import { EventStatusPill } from '@/components/ui/StatusPill'
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
    'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
    isActive ? 'bg-charcoal text-white' : 'text-ink-soft hover:bg-line/50',
  )
}

export function AdminShell() {
  const auth = useAdminAuth()
  const { event, eventId, loading, error, fromCache } = useAdminEvent()
  const [usingDefaultCreds] = useState(() => isUsingDefaultAdminCredentials())

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
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-charcoal text-white">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-ink">{event.name}</p>
              <p className="flex items-center gap-1.5 text-[11px] leading-tight text-muted">
                <EventStatusPill status={event.status} />
                {!event.purchasesEnabled && event.status === 'active' ? (
                  <span className="text-warn">purchases paused</span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <ConnectionBadge fromCache={fromCache} loading={loading} error={error} />
            <div className="hidden items-center gap-2 text-xs text-muted sm:flex">
              <span className="max-w-[160px] truncate">{auth.displayName}</span>
              {auth.role === 'superAdmin' ? (
                <span className="rounded-full bg-charcoal px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  super
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void auth.signOut()}
              className="text-xs font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6" aria-label="Admin sections">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : false} className={navClass}>
              <item.icon className="size-3.5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        {usingDefaultCreds ? (
          <div className="border-t border-warn/25 bg-warn-soft px-4 py-1.5 text-center text-[11px] font-medium text-warn sm:px-6">
            Using the default admin credentials (admin/admin). Set ADMIN_LOGIN_PASSWORD in
            functions/.env and redeploy before the real event.
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
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
            className="mt-4 h-10 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Sign out
          </button>
        </div>
      </main>
    )
  }
  return <>{children}</>
}
