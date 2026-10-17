import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router'
import { AlertTriangle, History, RotateCcw, Search } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { useAuditLogs, usePurchases, useTeams } from '@/data/hooks'
import { currency, formatDateTime, formatRelative, points as formatPoints, shortId } from '@/lib/format'
import { normalizeName } from '@shared/text'
import type { PurchaseDoc } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { InputField, SelectField, TextareaField } from '@/components/ui/Field'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Pill, PurchaseStatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { reversePurchase } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'

type StatusFilter = 'all' | 'confirmed' | 'reversed'

const PAGE_SIZE = 100

export function TransactionsPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const toast = useToast()

  const purchases = usePurchases(eventId, 400)
  const teams = useTeams(eventId)
  const auditLogs = useAuditLogs(eventId, 400)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [teamFilter, setTeamFilter] = useState('all')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const [detail, setDetail] = useState<PurchaseDoc | null>(null)
  const [reversing, setReversing] = useState<PurchaseDoc | null>(null)
  const [reason, setReason] = useState('')
  const [reversalBusy, setReversalBusy] = useState(false)
  const [reversalError, setReversalError] = useState<string | null>(null)

  const currencyLabel = event?.currencyLabel ?? '₹'

  // Operator labels come from the audit log (admin-only reads); the purchase
  // document itself deliberately stores no admin identity.
  const operators = useMemo(() => {
    const map = new Map<string, string>()
    for (const log of auditLogs.data) {
      if (log.action === 'purchase.recorded' || log.action === 'purchase.reversed') {
        if (!map.has(log.targetId)) {
          map.set(log.targetId, log.actorEmail ?? shortId(log.actorUid, 8))
        }
      }
    }
    return map
  }, [auditLogs.data])

  const filtered = useMemo(() => {
    const term = normalizeName(search)
    return purchases.data.filter((purchase) => {
      if (statusFilter !== 'all' && purchase.status !== statusFilter) return false
      if (teamFilter !== 'all' && purchase.teamId !== teamFilter) return false
      if (term === '') return true
      return normalizeName(
        `${purchase.playerNameSnapshot} ${purchase.teamNameSnapshot} ${operators.get(purchase.id) ?? ''}`,
      ).includes(term)
    })
  }, [purchases.data, statusFilter, teamFilter, search, operators])

  const shown = filtered.slice(0, visible)

  function openReversal(purchase: PurchaseDoc): void {
    setDetail(null)
    setReversing(purchase)
    setReason('')
    setReversalError(null)
  }

  async function confirmReversal(): Promise<void> {
    if (!reversing) return
    if (reason.trim().length < 3) {
      setReversalError('Enter a reason (at least 3 characters).')
      return
    }
    setReversalBusy(true)
    setReversalError(null)
    try {
      const result = await reversePurchase(eventId, reversing.id, reason.trim())
      toast.push({
        kind: 'success',
        message: `Reversed: ${result.playerName} returned to the pool.`,
        detail: `${result.teamName} was refunded ${currency(result.refundedPrice, currencyLabel)} and ${formatPoints(result.removedPoints)} points were removed.`,
      })
      setReversing(null)
    } catch (error) {
      setReversalError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setReversalBusy(false)
    }
  }

  const reversingTeam = reversing ? teams.data.find((team) => team.id === reversing.teamId) : null

  return (
    <div>

      <Card>
        <CardBody className="grid gap-3 pb-3 sm:grid-cols-[1fr_150px_180px]">
          <InputField
            label="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setVisible(PAGE_SIZE)
            }}
            placeholder="Player, team or operator…"
          />
          <SelectField label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="reversed">Reversed</option>
          </SelectField>
          <SelectField label="Team" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="all">All teams</option>
            {[...teams.data]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </SelectField>
        </CardBody>

        {purchases.loading ? (
          <LoadingBlock label="Loading transactions…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<History className="size-8" aria-hidden />}
            title={purchases.data.length === 0 ? 'No transactions yet' : 'No transactions match the filters'}
            description={purchases.data.length === 0 ? 'Recorded purchases appear here instantly.' : 'Adjust the filters above.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 sm:px-5">Time</th>
                    <th className="px-3 py-2.5">Player</th>
                    <th className="px-3 py-2.5">Team</th>
                    <th className="px-3 py-2.5 text-right">Price</th>
                    <th className="hidden px-3 py-2.5 lg:table-cell">Operator</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right sm:px-5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-surface-muted/60">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted sm:px-5">
                        {formatRelative(purchase.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          className="text-left font-medium text-ink hover:text-accent hover:underline"
                          onClick={() => setDetail(purchase)}
                        >
                          {purchase.playerNameSnapshot}
                        </button>
                        <span className="block text-[11px] text-muted">{formatPoints(purchase.playerPointsSnapshot)} pts</span>
                      </td>
                      <td className="px-3 py-3">{purchase.teamNameSnapshot}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {currency(purchase.finalPrice, currencyLabel)}
                      </td>
                      <td className="hidden px-3 py-3 text-xs text-muted lg:table-cell">
                        {operators.get(purchase.id) ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <PurchaseStatusPill status={purchase.status} />
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setDetail(purchase)}>
                            Details
                          </Button>
                          {purchase.status === 'confirmed' ? (
                            <Button
                              variant="dangerOutline"
                              size="sm"
                              icon={<RotateCcw className="size-3.5" aria-hidden />}
                              onClick={() => openReversal(purchase)}
                            >
                              Reverse
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
              <span className="flex items-center gap-1.5">
                <Search className="size-3.5" aria-hidden />
                {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
                {purchases.data.length >= 400 ? ' (showing the newest 400)' : ''}
              </span>
              {visible < filtered.length ? (
                <Button variant="secondary" size="sm" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
                  Show more ({filtered.length - visible} remaining)
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Card>

      {/* Detail dialog */}
      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `${detail.playerNameSnapshot} → ${detail.teamNameSnapshot}` : ''}
        size="sm"
        footer={
          detail?.status === 'confirmed' ? (
            <Button variant="dangerOutline" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => detail && openReversal(detail)}>
              Reverse this purchase
            </Button>
          ) : null
        }
      >
        {detail ? (
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Status</dt>
              <dd><PurchaseStatusPill status={detail.status} /></dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Final price</dt>
              <dd className="font-semibold tabular-nums">{currency(detail.finalPrice, currencyLabel)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Player points</dt>
              <dd className="tabular-nums">{formatPoints(detail.playerPointsSnapshot)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Recorded</dt>
              <dd>{formatDateTime(detail.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Operator</dt>
              <dd>{operators.get(detail.id) ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Request id</dt>
              <dd className="font-mono text-xs">{shortId(detail.requestId, 14)}</dd>
            </div>
            {detail.status === 'reversed' ? (
              <>
                <div className="flex justify-between gap-4 border-t border-line pt-2.5">
                  <dt className="text-muted">Reversed</dt>
                  <dd>{formatDateTime(detail.reversedAt)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Reason</dt>
                  <dd className="text-right">{detail.reversalReason ?? '—'}</dd>
                </div>
              </>
            ) : null}
          </dl>
        ) : null}
      </Dialog>

      {/* Reversal dialog */}
      <Dialog
        open={reversing !== null}
        onClose={() => setReversing(null)}
        title={reversing ? `Reverse ${reversing.playerNameSnapshot} → ${reversing.teamNameSnapshot}` : ''}
        description="This cannot be undone automatically. The player returns to the pool and can be sold again."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReversing(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={reversalBusy} onClick={() => void confirmReversal()}>
              Reverse purchase
            </Button>
          </>
        }
      >
        {reversing ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm text-amber-300">
              <p className="flex items-center gap-2 font-bold text-amber-200">
                <AlertTriangle className="size-4 text-amber-400" aria-hidden />
                What will happen
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-200/90">
                <li>
                  {reversing.teamNameSnapshot} is refunded <span className="font-bold text-white">{currency(reversing.finalPrice, currencyLabel)}</span>
                  {reversingTeam ? ` (remaining purse becomes ${currency(reversingTeam.remainingPurse + reversing.finalPrice, currencyLabel)})` : ''}.
                </li>
                <li>{formatPoints(reversing.playerPointsSnapshot)} points are removed from the team.</li>
                <li>The team's roster count decreases by one.</li>
                <li>{reversing.playerNameSnapshot} becomes available for sale again.</li>
              </ul>
            </div>
            <TextareaField
              label="Reason for the reversal"
              value={reason}
              maxLength={240}
              autoFocus
              onChange={(event) => setReason(event.target.value)}
              hint="Stored on the purchase record and in the audit log."
            />
            {reversalError ? (
              <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm font-semibold text-rose-300">
                {reversalError}
              </p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <Pill tone="info">Tip</Pill>
        Reversed purchases stay in this list forever for the audit trail.
      </p>
    </div>
  )
}
