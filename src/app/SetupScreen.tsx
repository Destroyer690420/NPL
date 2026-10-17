import { missingSupabaseKeys } from '@/lib/config'

/**
 * Shown when the Supabase web configuration is missing. The app deliberately
 * does not fake data: without credentials nothing else is rendered.
 */
export function SetupScreen() {
  const missing = missingSupabaseKeys()
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-card border border-line bg-surface p-6 shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
          College IPL Auction Manager
        </p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Supabase is not configured yet</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Copy <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">.env.example</code> to{' '}
          <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">.env.local</code> and fill in
          your Supabase project values, then restart the dev server.
        </p>
        {missing.length > 0 ? (
          <div className="mt-4 rounded-control border border-warn/25 bg-warn-soft px-4 py-3">
            <p className="text-xs font-medium text-warn">Still missing:</p>
            <ul className="mt-1 list-inside list-disc text-xs text-warn">
              {missing.map((key) => (
                <li key={key}>
                  <code>{key}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ol className="mt-4 list-inside list-decimal space-y-1.5 text-sm text-ink-soft">
          <li>
            Open the Supabase dashboard → Project Settings → API and copy the Project URL and the
            publishable (anon) key.
          </li>
          <li>
            Paste them into <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">.env.local</code>{' '}
            as <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">VITE_SUPABASE_ANON_KEY</code>.
          </li>
          <li>
            Run the SQL files in{' '}
            <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">supabase/migrations/</code> in
            the SQL Editor, in order.
          </li>
          <li>
            Deploy the <code className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">auction-api</code>{' '}
            edge function and set its secrets — see README.md.
          </li>
        </ol>
        <p className="mt-4 text-xs text-muted">See README.md for the full setup guide.</p>
      </div>
    </main>
  )
}
