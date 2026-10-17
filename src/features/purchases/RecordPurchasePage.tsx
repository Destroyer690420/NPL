import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  RotateCcw,
  Search,
  ShoppingCart,
} from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, usePurchases, useTeams } from '@/data/hooks'
import { isCallError } from '@/services/callables'
import { recordPurchase, type RecordPurchaseResult } from '@/services/admin'
import { fetchPurchaseFromServer } from '@/services/reads'
import { newRequestId } from '@/lib/ids'
import { errorMessage, toFriendlyError, type FriendlyError } from '@/lib/errors'
import { currency, formatRelative, points as formatPoints } from '@/lib/format'
import { parseAmountInput, subtractInts, addInts } from '@shared/money'
import { PageHeader, SectionTitle } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { InputField } from '@/components/ui/Field'
import { Combobox, type ComboboxItem } from '@/components/ui/Combobox'
import { EmptyState, Skeleton } from '@/components/ui/Feedback'
import { Pill, PurchaseStatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'

interface Attempt {
  requestId: string
  playerId: string
  teamId: string
  price: number
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'failed'; attempt: Attempt; error: FriendlyError }
  | { kind: 'success'; result: RecordPurchaseResult }

function sameAttempt(a: Attempt, b: Attempt): boolean {
  return a.playerId === b.playerId && a.teamId === b.teamId && a.price === b.price
}

export function RecordPurchasePage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const toast = useToast()

  const players = usePlayers(eventId)
  const teams = useTeams(eventId)
  const purchases = usePurchases(eventId, 10)

  const [playerId, setPlayerId] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string | null>(null)
  const [priceText, setPriceText] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' })
  const lastAttempt = useRef<Attempt | null>(null)

  const selectedPlayer = useMemo(
    () => players.data.find((player) => player.id === playerId) ?? null,
    [players.data, playerId],
  )
  const selectedTeam = useMemo(
    () => teams.data.find((team) => team.id === teamId) ?? null,
    [teams.data, teamId],
  )
  const price = parseAmountInput(priceText, false)
  const currencyLabel = event?.currencyLabel ?? '₹'
  const eventActive = event?.status === 'active'
  const purchasesEnabled = event?.purchasesEnabled !== false

  const lastPrefilledPlayerIdRef = useRef<string | null>(null)

  // Prefill the price with the base price when a player is chosen; typing wins.
  useEffect(() => {
    if (selectedPlayer) {
      if (lastPrefilledPlayerIdRef.current !== selectedPlayer.id) {
        lastPrefilledPlayerIdRef.current = selectedPlayer.id
        setPriceText(String(selectedPlayer.basePrice))
      }
    } else {
      lastPrefilledPlayerIdRef.current = null
    }
  }, [selectedPlayer])

  const blocking: string[] = []
  if (!eventActive) {
    blocking.push(
      event?.status === 'finalized'
        ? 'The event is finalized. Reopen it in Settings if a sale must be corrected.'
        : 'The auction has not started yet. Start it in Settings before selling.',
    )
  } else if (!purchasesEnabled) {
    blocking.push('Recording purchases is paused. Re-enable it in Settings.')
  }
  if (selectedPlayer && selectedPlayer.status !== 'available') {
    blocking.push(
      selectedPlayer.status === 'sold'
        ? 'This player has already been sold. It may have been another operator.'
        : 'This player is withdrawn and cannot be sold.',
    )
  }
  if (selectedTeam && !selectedTeam.active) {
    blocking.push('This team is deactivated and cannot buy players.')
  }
  if (selectedTeam && price !== null && price > selectedTeam.remainingPurse) {
    blocking.push(
      `The price exceeds ${selectedTeam.name}'s remaining purse of ${currency(selectedTeam.remainingPurse, currencyLabel)}.`,
    )
  }
  if (
    selectedTeam &&
    event &&
    event.maxRosterSize !== null &&
    selectedTeam.playerCount >= event.maxRosterSize
  ) {
    blocking.push(`${selectedTeam.name} has reached the maximum roster size of ${event.maxRosterSize}.`)
  }

  const ready = Boolean(selectedPlayer && selectedTeam && price !== null && blocking.length === 0)

  const projected = useMemo(() => {
    if (!selectedTeam || price === null) return null
    return {
      remainingPurse: subtractInts(selectedTeam.startingPurse, addInts(selectedTeam.totalSpent, price)),
      totalPoints: addInts(selectedTeam.totalPoints, selectedPlayer?.points ?? 0),
      playerCount: selectedTeam.playerCount + 1,
    }
  }, [selectedTeam, selectedPlayer, price])

  function resetForm(): void {
    setPlayerId(null)
    setTeamId(null)
    setPriceText('')
    lastPrefilledPlayerIdRef.current = null
    lastAttempt.current = null
    setSubmit({ kind: 'idle' })
  }

  function currentAttempt(): Attempt {
    const next: Attempt = {
      requestId: newRequestId(),
      playerId: playerId ?? '',
      teamId: teamId ?? '',
      price: price ?? 0,
    }
    const previous = lastAttempt.current
    // Reuse the id when retrying the exact same submission (safe idempotent retry).
    if (previous && sameAttempt(previous, next)) return previous
    lastAttempt.current = next
    return next
  }

  async function submitPurchase(attempt: Attempt): Promise<void> {
    setSubmit({ kind: 'submitting' })
    try {
      const result = await recordPurchase({
        eventId,
        playerId: attempt.playerId,
        teamId: attempt.teamId,
        finalPrice: attempt.price,
        requestId: attempt.requestId,
      })
      setSubmit({ kind: 'success', result })
      setConfirmOpen(false)
      lastAttempt.current = null
      toast.push({
        kind: 'success',
        message: `${result.playerName} sold to ${result.teamName} for ${currency(result.finalPrice, currencyLabel)}.`,
        detail: result.idempotentReplay ? 'This submission had already been recorded once.' : undefined,
      })
    } catch (error) {
      const friendly = isCallError(error) ? toFriendlyError(error) : toFriendlyError(error)
      setSubmit({ kind: 'failed', attempt, error: friendly })
      setConfirmOpen(false)
      if (friendly.code === 'player-already-sold' || friendly.code === 'player-status-conflict') {
        // Another operator sold the player: drop the selection and refresh.
        setPlayerId(null)
        setPriceText('')
        lastPrefilledPlayerIdRef.current = null
      }
      toast.push({ kind: 'error', message: friendly.message, detail: friendly.hint })
    }
  }

  async function checkStatus(): Promise<void> {
    if (submit.kind !== 'failed') return
    const attempt = submit.attempt
    try {
      const existing = await fetchPurchaseFromServer(eventId, attempt.requestId)
      if (existing) {
        const team = teams.data.find((entry) => entry.id === existing.teamId)
        setSubmit({
          kind: 'success',
          result: {
            purchaseId: existing.id,
            playerId: existing.playerId,
            playerName: existing.playerNameSnapshot,
            playerPoints: existing.playerPointsSnapshot,
            teamId: existing.teamId,
            teamName: existing.teamNameSnapshot,
            finalPrice: existing.finalPrice,
            teamSummary: {
              startingPurse: team?.startingPurse ?? 0,
              totalSpent: team?.totalSpent ?? 0,
              remainingPurse: team?.remainingPurse ?? 0,
              totalPoints: team?.totalPoints ?? 0,
              playerCount: team?.playerCount ?? 0,
            },
            idempotentReplay: true,
          },
        })
        lastAttempt.current = null
        toast.push({
          kind: 'success',
          message: 'The purchase was in fact recorded.',
          detail: 'The retry is no longer needed — the receipt is shown below.',
        })
      } else {
        toast.push({
          kind: 'info',
          message: 'Not recorded yet.',
          detail: 'You can correct the form and try again, or retry the same submission safely.',
        })
      }
    } catch (error) {
      toast.push({ kind: 'error', message: errorMessage(error) })
    }
  }

  const playerItems: ComboboxItem[] = useMemo(
    () =>
      players.data.map((player) => ({
        id: player.id,
        label: player.name,
        keywords: `${player.externalReference ?? ''} ${player.notes ?? ''}`,
        disabled: player.status !== 'available',
        disabledReason: player.status === 'sold' ? 'Sold' : player.status === 'withdrawn' ? 'Withdrawn' : undefined,
        sublabel: `${formatPoints(player.points)} pts · base ${currency(player.basePrice, currencyLabel)}${player.externalReference ? ` · ${player.externalReference}` : ''}`,
      })),
    [players.data, currencyLabel],
  )

  const teamItems: ComboboxItem[] = useMemo(
    () =>
      teams.data.map((team) => ({
        id: team.id,
        label: team.name,
        keywords: team.name,
        disabled: !team.active,
        disabledReason: team.active ? undefined : 'Inactive',
        sublabel: `${currency(team.remainingPurse, currencyLabel)} purse · ${team.playerCount} players`,
      })),
    [teams.data, currencyLabel],
  )

  const recent = purchases.data.slice(0, 8)

  return (
    <div>
      <PageHeader
        title="Record purchase"
        description="Sell one player to one team. The purchase is validated and written atomically on the server."
      />

      {!eventActive || !purchasesEnabled ? (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="size-4 shrink-0 text-amber-400" aria-hidden />
          <span className="flex-1 font-medium">
            {event?.status === 'finalized'
              ? 'The event is finalized — new purchases are disabled.'
              : event?.status === 'active'
                ? 'Purchases are paused.'
                : 'The auction has not started yet.'}
          </span>
          <Link to="/admin/settings" className="text-xs font-bold uppercase tracking-wider text-amber-300 underline underline-offset-4 hover:text-white">
            Open settings →
          </Link>
        </div>
      ) : null}

      {submit.kind === 'success' ? (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-lg">
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-white">
                {submit.result.playerName} sold to {submit.result.teamName}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                <span className="font-bold text-emerald-400">{currency(submit.result.finalPrice, currencyLabel)}</span> ·{' '}
                <span className="text-sky-300">{formatPoints(submit.result.playerPoints)} pts</span> ·{' '}
                {submit.result.teamName}'s purse is now{' '}
                <span className="font-bold text-white">
                  {currency(submit.result.teamSummary.remainingPurse, currencyLabel)}
                </span>
              </p>
              {submit.result.idempotentReplay ? (
                <p className="mt-1.5 text-xs text-ink-muted">
                  Recorded once — this retry did not charge the team twice.
                </p>
              ) : null}
            </div>
            <div className="flex gap-2.5">
              <Button variant="secondary" onClick={resetForm} icon={<RotateCcw className="size-4" aria-hidden />}>
                Record another
              </Button>
              <Link to="/admin/transactions">
                <Button variant="ghost">Transactions</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>New sale</CardTitle>
            {players.loading || teams.loading ? <Pill tone="neutral">Loading…</Pill> : null}
          </CardHeader>
          <CardBody className="space-y-5">
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-ink-soft">Player</span>
              <Combobox
                items={playerItems}
                value={playerId}
                onChange={(id) => {
                  setPlayerId(id)
                  setSubmit((current) => (current.kind === 'failed' ? { kind: 'idle' } : current))
                }}
                placeholder="Search players by name or ID…"
                emptyMessage="No players match. Add players before selling."
                ariaLabel="Search and select a player"
              />
              {selectedPlayer ? (
                <p className="text-xs text-muted">
                  {formatPoints(selectedPlayer.points)} points · base price{' '}
                  {currency(selectedPlayer.basePrice, currencyLabel)}
                  {selectedPlayer.status !== 'available' ? (
                    <span className="ml-1 font-medium text-danger">
                      <Ban className="mr-0.5 inline size-3" aria-hidden />
                      {selectedPlayer.status === 'sold' ? 'Already sold' : 'Withdrawn'}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-ink-soft">Winning team</span>
              <Combobox
                items={teamItems}
                value={teamId}
                onChange={(id) => {
                  setTeamId(id)
                  setSubmit((current) => (current.kind === 'failed' ? { kind: 'idle' } : current))
                }}
                placeholder="Search teams…"
                emptyMessage="No teams match. Add teams first."
                ariaLabel="Search and select a team"
              />
            </div>

            <InputField
              label={`Final sale price (${currencyLabel})`}
              inputMode="numeric"
              value={priceText}
              placeholder="e.g. 20000"
              onChange={(event) => {
                setPriceText(event.target.value)
                setSubmit((current) => (current.kind === 'failed' ? { kind: 'idle' } : current))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && ready) {
                  event.preventDefault()
                  setConfirmOpen(true)
                }
              }}
              hint={
                selectedPlayer && price !== null ? (
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-ink"
                    onClick={() => {
                      setPriceText(String(selectedPlayer.basePrice))
                    }}
                  >
                    Use base price {currency(selectedPlayer.basePrice, currencyLabel)}
                  </button>
                ) : (
                  'Whole numbers only. Prefilled with the base price — adjust as auctioned.'
                )
              }
              error={priceText.trim() !== '' && price === null ? 'Enter a whole, positive amount.' : undefined}
            />

            {selectedTeam && price !== null ? (
              <div className="rounded-xl border border-line-strong bg-surface-muted/50 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                  Pre-confirmation summary
                </p>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-[11px] font-medium text-ink-muted">Remaining purse</dt>
                    <dd className="mt-0.5 font-bold tabular-nums text-white">{currency(selectedTeam.remainingPurse, currencyLabel)}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-ink-muted">After purchase</dt>
                    <dd className="mt-0.5 font-extrabold tabular-nums text-accent">
                      {projected ? currency(projected.remainingPurse, currencyLabel) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-ink-muted">Points after</dt>
                    <dd className="mt-0.5 font-bold tabular-nums text-sky-400">
                      {projected ? formatPoints(projected.totalPoints) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium text-ink-muted">Squad after</dt>
                    <dd className="mt-0.5 font-bold tabular-nums text-white">{projected ? projected.playerCount : '—'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {blocking.length > 0 ? (
              <ul className="space-y-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                {blocking.map((message, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm font-medium text-rose-300">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-400" aria-hidden />
                    {message}
                  </li>
                ))}
              </ul>
            ) : null}

            {submit.kind === 'failed' ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
                <p className="text-sm font-bold text-rose-300">{submit.error.message}</p>
                {submit.error.hint ? <p className="mt-1 text-xs text-rose-400/90">{submit.error.hint}</p> : null}
                {submit.error.retryable ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => void submitPurchase(submit.attempt)}>
                      Retry same submission
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void checkStatus()}>
                      Check if it was recorded
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <Button
              block
              size="lg"
              disabled={!ready || submit.kind === 'submitting'}
              loading={submit.kind === 'submitting'}
              icon={<ShoppingCart className="size-4" aria-hidden />}
              onClick={() => setConfirmOpen(true)}
            >
              Review &amp; confirm purchase
            </Button>
          </CardBody>
        </Card>

        <div className="lg:col-span-2">
          <SectionTitle>Recent purchases</SectionTitle>
          <Card className="mt-3">
            {purchases.loading ? (
              <CardBody className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardBody>
            ) : recent.length === 0 ? (
              <EmptyState title="Nothing sold yet" description="Purchases appear here the moment they are recorded." icon={<Search className="size-8" aria-hidden />} />
            ) : (
              <ul className="divide-y divide-line">
                {recent.map((purchase) => (
                  <li key={purchase.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-ink">
                        {purchase.playerNameSnapshot}
                        <span className="font-normal text-muted"> → {purchase.teamNameSnapshot}</span>
                      </p>
                      <p className="text-[11px] text-muted">
                        {formatPoints(purchase.playerPointsSnapshot)} pts · {formatRelative(purchase.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-semibold tabular-nums">
                        {currency(purchase.finalPrice, currencyLabel)}
                      </p>
                      <PurchaseStatusPill status={purchase.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Confirm purchase for ${selectedTeam?.name ?? 'the team'}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!ready || submit.kind === 'submitting'}
              loading={submit.kind === 'submitting'}
              icon={<BadgeCheck className="size-4" aria-hidden />}
              onClick={() => void submitPurchase(currentAttempt())}
            >
              Confirm purchase
            </Button>
          </>
        }
      >
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Player</dt>
            <dd className="text-right font-medium">{selectedPlayer?.name ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Player points</dt>
            <dd className="text-right font-medium tabular-nums">
              {selectedPlayer ? formatPoints(selectedPlayer.points) : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Team</dt>
            <dd className="text-right font-medium">{selectedTeam?.name ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Final price</dt>
            <dd className="text-right font-semibold tabular-nums text-accent">
              {price !== null ? currency(price, currencyLabel) : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-2.5">
            <dt className="text-muted">Purse after purchase</dt>
            <dd className="text-right font-medium tabular-nums">
              {projected ? currency(projected.remainingPurse, currencyLabel) : '—'}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">
          This charges the team once. If the connection drops, retrying this submission is safe —
          the same request id is reused.
        </p>
      </Dialog>
    </div>
  )
}
