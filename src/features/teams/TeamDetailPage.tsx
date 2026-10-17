import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import { ArrowLeft, KeyRound, LogOut, Pencil, Power, PowerOff, ShieldCheck } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { useAuditLogs, useTeamDoc, useTeamPurchases } from '@/data/hooks'
import { currency, formatDateTime, formatRelative, points as formatPoints } from '@/lib/format'
import { AUDIT_ACTION_LABELS } from '@/lib/labels'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle, StatCard } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { TextareaField } from '@/components/ui/Field'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { Pill, PurchaseStatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import {
  getTeamPinStatus,
  resetTeamPin,
  revokeTeamSessions,
  updateTeam,
} from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { TeamFormDialog, type TeamFormValues } from './TeamFormDialog'
import { PinRevealDialog } from './PinRevealDialog'

export function TeamDetailPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { teamId = '' } = useParams()
  const { event } = useAdminEvent()
  const toast = useToast()
  const navigate = useNavigate()

  const team = useTeamDoc(eventId, teamId)
  const purchases = useTeamPurchases(eventId, teamId, 100)
  const auditLogs = useAuditLogs(eventId, 100)

  const [editOpen, setEditOpen] = useState(false)
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [reveal, setReveal] = useState<string | null>(null)
  const [pinStatus, setPinStatus] = useState<{ configured: boolean; pinVersion: number } | null>(null)
  const [pinBusy, setPinBusy] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeBusy, setRevokeBusy] = useState(false)
  const [activeBusy, setActiveBusy] = useState(false)

  const currencyLabel = event?.currencyLabel ?? '₹'

  const teamAudits = useMemo(
    () => auditLogs.data.filter((log) => log.targetType === 'team' && log.targetId === teamId).slice(0, 12),
    [auditLogs.data, teamId],
  )

  if (team.loading) return <LoadingBlock label="Loading team…" />
  if (!team.data) {
    return (
      <div>
        <PageHeader title="Team not found" />
        <EmptyState
          title="This team does not exist"
          description="It may have been removed or the link is out of date."
          action={
            <Link to="/admin/teams">
              <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-3.5" aria-hidden />}>
                Back to teams
              </Button>
            </Link>
          }
        />
      </div>
    )
  }

  const data = team.data
  const confirmed = purchases.data.filter((purchase) => purchase.status === 'confirmed')

  async function save(values: TeamFormValues): Promise<void> {
    setFormSubmitting(true)
    setFormError(null)
    try {
      const result = await updateTeam({
        eventId,
        teamId,
        name: values.name,
        logoUrl: values.logoUrl,
        startingPurse: values.startingPurse,
        reason: values.reason,
      })
      setEditOpen(false)
      setPinStatus(null)
      toast.push({
        kind: 'success',
        message: 'Team updated.',
        detail: result.sessionsRevoked ? 'Open sessions were revoked because the team was deactivated.' : undefined,
      })
    } catch (error) {
      setFormError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setFormSubmitting(false)
    }
  }

  async function checkPin(): Promise<void> {
    setPinBusy(true)
    try {
      const status = await getTeamPinStatus(eventId, teamId)
      setPinStatus(status)
      if (!status.configured) {
        toast.push({ kind: 'info', message: 'No PIN is configured for this team yet. Reset the PIN to create one.' })
      }
    } catch (error) {
      toast.push({ kind: 'error', message: errorMessage(error) })
    } finally {
      setPinBusy(false)
    }
  }

  async function resetPin(): Promise<void> {
    setPinBusy(true)
    try {
      const result = await resetTeamPin(eventId, teamId)
      setReveal(result.pin)
      setPinStatus({ configured: true, pinVersion: result.pinVersion })
      if (result.sessionsRevoked > 0) {
        toast.push({
          kind: 'info',
          message: `${result.sessionsRevoked} open session${result.sessionsRevoked === 1 ? '' : 's'} revoked.`,
        })
      }
    } catch (error) {
      toast.push({ kind: 'error', message: errorMessage(error) })
    } finally {
      setPinBusy(false)
    }
  }

  async function revokeSessions(): Promise<void> {
    setRevokeBusy(true)
    try {
      const result = await revokeTeamSessions(eventId, teamId, revokeReason.trim() || null)
      setRevokeOpen(false)
      setRevokeReason('')
      toast.push({
        kind: 'success',
        message: result.revoked === 0 ? 'No open sessions found.' : `${result.revoked} session${result.revoked === 1 ? '' : 's'} revoked.`,
      })
    } catch (error) {
      toast.push({ kind: 'error', message: errorMessage(error) })
    } finally {
      setRevokeBusy(false)
    }
  }

  async function toggleActive(): Promise<void> {
    setActiveBusy(true)
    try {
      const nextActive = !data.active
      await updateTeam({
        eventId,
        teamId,
        active: nextActive,
        reason: nextActive ? 'Reactivated by admin' : 'Deactivated by admin',
      })
      toast.push({
        kind: 'success',
        message: nextActive ? 'Team reactivated.' : 'Team deactivated. Open sessions were revoked.',
      })
    } catch (error) {
      toast.push({ kind: 'error', message: isCallError(error) ? error.message : errorMessage(error) })
    } finally {
      setActiveBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={data.name}
        description={
          <span className="flex items-center gap-2">
            {data.active ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
            {team.data.logoUrl ? (
              <span className="truncate text-xs text-muted">{team.data.logoUrl}</span>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link to="/admin/teams">
              <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" aria-hidden />}>
                Teams
              </Button>
            </Link>
            <Button variant="secondary" size="sm" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button
              variant={data.active ? 'dangerOutline' : 'secondary'}
              size="sm"
              loading={activeBusy}
              icon={data.active ? <PowerOff className="size-3.5" aria-hidden /> : <Power className="size-3.5" aria-hidden />}
              onClick={() => void toggleActive()}
            >
              {data.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Remaining purse" value={currency(data.remainingPurse, currencyLabel)} tone="accent" hint={`of ${currency(data.startingPurse, currencyLabel)}`} />
        <StatCard label="Total spent" value={currency(data.totalSpent, currencyLabel)} />
        <StatCard label="Points" value={formatPoints(data.totalPoints)} />
        <StatCard label="Players" value={formatPoints(data.playerCount)} hint={event?.maxRosterSize ? `max ${event.maxRosterSize}` : 'no roster limit'} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Roster</CardTitle>
            <span className="text-xs text-muted">{confirmed.length} confirmed purchases</span>
          </CardHeader>
          {purchases.loading ? (
            <CardBody><LoadingBlock label="Loading roster…" /></CardBody>
          ) : purchases.data.length === 0 ? (
            <EmptyState title="No purchases yet" description="Sold players appear here with the price the team paid." />
          ) : (
            <ul className="divide-y divide-line">
              {purchases.data.map((purchase) => (
                <li key={purchase.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{purchase.playerNameSnapshot}</p>
                    <p className="text-xs text-muted">
                      {formatPoints(purchase.playerPointsSnapshot)} pts · {formatDateTime(purchase.createdAt)}
                      {purchase.status === 'reversed' && purchase.reversalReason
                        ? ` · reversed: ${purchase.reversalReason}`
                        : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{currency(purchase.finalPrice, currencyLabel)}</p>
                    <PurchaseStatusPill status={purchase.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Team login</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">
                Team members open <code className="rounded bg-surface-muted px-1 py-0.5">/team</code> and enter
                their four-digit PIN to see this purse and roster live.
              </p>
              {pinStatus ? (
                <p className="text-xs text-muted">
                  PIN {pinStatus.configured ? `configured (version ${pinStatus.pinVersion})` : 'not configured yet'}.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" loading={pinBusy} icon={<ShieldCheck className="size-3.5" aria-hidden />} onClick={() => void checkPin()}>
                  Check PIN status
                </Button>
                <Button size="sm" loading={pinBusy} icon={<KeyRound className="size-3.5" aria-hidden />} onClick={() => void resetPin()}>
                  Reset PIN
                </Button>
                <Button variant="ghost" size="sm" icon={<LogOut className="size-3.5" aria-hidden />} onClick={() => setRevokeOpen(true)}>
                  Sign out sessions
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team activity</CardTitle>
            </CardHeader>
            {teamAudits.length === 0 ? (
              <EmptyState title="No activity for this team yet" />
            ) : (
              <ul className="divide-y divide-line">
                {teamAudits.map((log) => (
                  <li key={log.id} className="px-4 py-2.5 sm:px-5">
                    <p className="text-[13px] text-ink">{AUDIT_ACTION_LABELS[log.action] ?? log.action}</p>
                    <p className="text-[11px] text-muted">
                      {log.actorEmail ?? log.actorUid.slice(0, 8)} · {formatRelative(log.createdAt)}
                      {log.reason ? ` · ${log.reason}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <TeamFormDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={(values) => void save(values)}
        team={data}
        defaultStartingPurse={event?.defaultStartingPurse ?? 0}
        currencyLabel={currencyLabel}
        submitting={formSubmitting}
        error={formError}
      />

      {reveal ? (
        <PinRevealDialog
          open
          teamName={data.name}
          pin={reveal}
          onDone={() => {
            setReveal(null)
            navigate(`/admin/teams/${teamId}`, { replace: true })
          }}
        />
      ) : null}

      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title={`Sign out ${data.name}'s sessions`}
        description="Every device currently signed in with this team PIN will be signed out immediately."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevokeOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={revokeBusy} onClick={() => void revokeSessions()}>
              Revoke sessions
            </Button>
          </>
        }
      >
        <TextareaField
          label="Reason"
          optional
          value={revokeReason}
          maxLength={240}
          onChange={(event) => setRevokeReason(event.target.value)}
          hint="Stored in the audit log."
        />
      </Dialog>
    </div>
  )
}
