import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Flag,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldAlert,
  Star,
} from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminAuth } from '@/auth/AdminAuthProvider'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, usePublicConfig, useTeams } from '@/data/hooks'
import { PageHeader, SectionTitle } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, InputField, TextareaField } from '@/components/ui/Field'
import { EventStatusPill, Pill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { checkEventConsistency, setDefaultEvent, updateEvent } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { parseAmountInput } from '@shared/money'
import { MAX_ROSTER_SIZE_LIMIT } from '@shared/constants'
import { formatRelative, points as formatPoints } from '@/lib/format'

export function SettingsPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const auth = useAdminAuth()
  const toast = useToast()
  const teams = useTeams(eventId)
  const players = usePlayers(eventId)
  const config = usePublicConfig()

  const [name, setName] = useState('')
  const [currencyLabel, setCurrencyLabel] = useState('')
  const [defaultPurse, setDefaultPurse] = useState('')
  const [maxRoster, setMaxRoster] = useState('')
  const [purchasesEnabled, setPurchasesEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [checkRunning, setCheckRunning] = useState(false)
  const [report, setReport] = useState<{ ok: boolean; problems: string[] } | null>(null)

  const [statusBusy, setStatusBusy] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenBusy, setReopenBusy] = useState(false)

  useEffect(() => {
    if (!event) return
    setName(event.name)
    setCurrencyLabel(event.currencyLabel)
    setDefaultPurse(String(event.defaultStartingPurse))
    setMaxRoster(event.maxRosterSize === null ? '' : String(event.maxRosterSize))
    setPurchasesEnabled(event.purchasesEnabled)
  }, [event])

  const dirty = useMemo(() => {
    if (!event) return false
    const purse = parseAmountInput(defaultPurse, true)
    const roster = maxRoster.trim() === '' ? null : Number(maxRoster.trim())
    return (
      name.trim() !== event.name ||
      currencyLabel.trim() !== event.currencyLabel ||
      purse !== event.defaultStartingPurse ||
      roster !== event.maxRosterSize ||
      purchasesEnabled !== event.purchasesEnabled
    )
  }, [event, name, currencyLabel, defaultPurse, maxRoster, purchasesEnabled])

  async function save(): Promise<void> {
    if (!event) return
    const purse = parseAmountInput(defaultPurse, true)
    const trimmedRoster = maxRoster.trim()
    const roster = trimmedRoster === '' ? null : Number(trimmedRoster)
    if (name.trim() === '') {
      setFormError('Event name is required.')
      return
    }
    if (currencyLabel.trim() === '') {
      setFormError('A currency or credit label is required.')
      return
    }
    if (purse === null) {
      setFormError('Default starting purse must be a whole number of 0 or more.')
      return
    }
    if (
      roster !== null &&
      (!Number.isSafeInteger(roster) || roster < 1 || roster > MAX_ROSTER_SIZE_LIMIT)
    ) {
      setFormError(`Max roster size must be between 1 and ${MAX_ROSTER_SIZE_LIMIT}, or empty for no limit.`)
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await updateEvent({
        eventId,
        name: name.trim(),
        currencyLabel: currencyLabel.trim(),
        defaultStartingPurse: purse,
        maxRosterSize: roster,
        purchasesEnabled,
      })
      toast.push({ kind: 'success', message: 'Settings saved.' })
    } catch (error) {
      setFormError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function runCheck(): Promise<{ ok: boolean; problems: string[] } | null> {
    setCheckRunning(true)
    try {
      const result = await checkEventConsistency(eventId)
      setReport({ ok: result.ok, problems: result.problems })
      return result
    } catch (error) {
      toast.push({ kind: 'error', message: errorMessage(error) })
      return null
    } finally {
      setCheckRunning(false)
    }
  }

  async function changeStatus(status: 'active' | 'finalized'): Promise<void> {
    setStatusBusy(true)
    try {
      const result = await updateEvent({ eventId, status })
      toast.push({
        kind: 'success',
        message:
          status === 'active'
            ? 'The auction is live. Team panels start updating immediately.'
            : 'The auction is finalized and read-only.',
        detail: result.problems.length > 0 ? result.problems.join(' ') : undefined,
      })
      if (status === 'finalized') void runCheck()
    } catch (error) {
      const message = isCallError(error) ? error.message : errorMessage(error)
      toast.push({ kind: 'error', message })
      if (message.toLowerCase().includes('consistency')) void runCheck()
    } finally {
      setStatusBusy(false)
    }
  }

  async function reopen(): Promise<void> {
    if (reopenReason.trim().length < 3) return
    setReopenBusy(true)
    try {
      await updateEvent({ eventId, status: 'active', reason: reopenReason.trim() })
      setReopenOpen(false)
      setReopenReason('')
      toast.push({ kind: 'success', message: 'Event reopened. Purchases are possible again.' })
    } catch (error) {
      toast.push({ kind: 'error', message: isCallError(error) ? error.message : errorMessage(error) })
    } finally {
      setReopenBusy(false)
    }
  }

  async function makeDefault(): Promise<void> {
    try {
      await setDefaultEvent(eventId)
      toast.push({
        kind: 'success',
        message: 'Default event updated.',
        detail: 'Team PIN logins now target this event.',
      })
    } catch (error) {
      toast.push({ kind: 'error', message: errorMessage(error) })
    }
  }

  if (!event) return null

  const isDefault = config.data?.defaultEventId === eventId
  const canStart = teams.data.length > 0 && players.data.length > 0

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Event details, auction lifecycle and integrity tools."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw className="size-4" aria-hidden />}
              loading={checkRunning}
              onClick={() => void runCheck()}
            >
              Consistency check
            </Button>
            <Button
              icon={<Save className="size-4" aria-hidden />}
              disabled={!dirty}
              loading={saving}
              onClick={() => void save()}
            >
              Save changes
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Event details</CardTitle>
            <EventStatusPill status={event.status} />
          </CardHeader>
          <CardBody className="space-y-4">
            <InputField label="Event name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField
                label="Currency label"
                value={currencyLabel}
                maxLength={12}
                onChange={(e) => setCurrencyLabel(e.target.value)}
                hint="e.g. ₹ or credits — shown everywhere amounts appear"
              />
              <InputField
                label="Default starting purse"
                value={defaultPurse}
                inputMode="numeric"
                onChange={(e) => setDefaultPurse(e.target.value)}
                hint="Pre-fills the add-team dialog"
              />
            </div>
            <InputField
              label="Maximum roster size per team"
              optional
              value={maxRoster}
              inputMode="numeric"
              onChange={(e) => setMaxRoster(e.target.value)}
              hint={`Leave empty for no limit (1–${MAX_ROSTER_SIZE_LIMIT}). Enforced on every purchase.`}
            />
            <CheckboxField
              label="Purchases enabled"
              description="Turn off to pause all recording instantly — useful during breaks. Team panels keep updating."
              checked={purchasesEnabled}
              onChange={setPurchasesEnabled}
            />
            {formError ? (
              <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Auction lifecycle</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">Status</span>
                <EventStatusPill status={event.status} />
              </div>
              <p className="text-xs text-muted">
                {event.status === 'setup'
                  ? `Setup — ${teams.data.length} team(s), ${players.data.length} player(s) ready. Starting makes purchases possible.`
                  : event.status === 'active'
                    ? 'Active — purchases are recorded against the latest server-side state.'
                    : 'Finalized — data is read-only. Only a super admin can reopen.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {event.status === 'setup' ? (
                  <Button
                    size="sm"
                    loading={statusBusy}
                    disabled={!canStart}
                    icon={<PlayCircle className="size-4" aria-hidden />}
                    onClick={() => void changeStatus('active')}
                    title={canStart ? undefined : 'Add at least one team and one player first'}
                  >
                    Start auction
                  </Button>
                ) : null}
                {event.status === 'active' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={statusBusy}
                    icon={event.purchasesEnabled ? <PauseCircle className="size-4" aria-hidden /> : <PlayCircle className="size-4" aria-hidden />}
                    onClick={() => {
                      setPurchasesEnabled((current) => !current)
                      void updateEvent({ eventId, purchasesEnabled: !event.purchasesEnabled }).catch((error: unknown) => {
                        setPurchasesEnabled(event.purchasesEnabled)
                        toast.push({ kind: 'error', message: errorMessage(error) })
                      })
                    }}
                  >
                    {event.purchasesEnabled ? 'Pause purchases' : 'Resume purchases'}
                  </Button>
                ) : null}
                {event.status === 'active' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={statusBusy}
                    icon={<Flag className="size-4" aria-hidden />}
                    onClick={() => void changeStatus('finalized')}
                  >
                    Finalize auction
                  </Button>
                ) : null}
                {event.status === 'finalized' && auth.role === 'superAdmin' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<ShieldAlert className="size-4" aria-hidden />}
                    onClick={() => setReopenOpen(true)}
                  >
                    Reopen auction
                  </Button>
                ) : null}
              </div>
              {!canStart && event.status === 'setup' ? (
                <p className="text-xs text-warn">
                  Add at least one team and one player before starting the auction.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Integrity</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {report ? (
                report.ok ? (
                  <p className="flex items-center gap-2 text-sm text-accent">
                    <CheckCircle2 className="size-4" aria-hidden />
                    All totals reconcile with the purchase records.
                  </p>
                ) : (
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-danger">
                      <AlertTriangle className="size-4" aria-hidden />
                      {report.problems.length} problem{report.problems.length === 1 ? '' : 's'} found
                    </p>
                    <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-danger">
                      {report.problems.map((problem, index) => (
                        <li key={index}>{problem}</li>
                      ))}
                    </ul>
                  </div>
                )
              ) : (
                <p className="text-xs text-muted">
                  Recomputes every team's purse, spend, points and roster from the purchase records
                  and compares them with the stored values. Finalising runs this automatically.
                </p>
              )}
              <Button variant="secondary" size="sm" loading={checkRunning} onClick={() => void runCheck()}>
                Run check now
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team login target</CardTitle>
              {isDefault ? <Pill tone="success">Default event</Pill> : null}
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">
                The <code className="rounded bg-surface-muted px-1 py-0.5">/team</code> PIN login uses the
                default event. Event id: <code className="rounded bg-surface-muted px-1 py-0.5">{eventId}</code>
                {config.data?.updatedAt ? ` · updated ${formatRelative(config.data.updatedAt)}` : ''}
              </p>
              {!isDefault ? (
                <Button variant="secondary" size="sm" icon={<Star className="size-3.5" aria-hidden />} onClick={() => void makeDefault()}>
                  Make this the default event
                </Button>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>At a glance</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted">Teams</p>
                <p className="font-semibold tabular-nums">{teams.data.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Players</p>
                <p className="font-semibold tabular-nums">{players.data.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Available</p>
                <p className="font-semibold tabular-nums">
                  {formatPoints(players.data.filter((player) => player.status === 'available').length)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Sold</p>
                <p className="font-semibold tabular-nums">
                  {formatPoints(players.data.filter((player) => player.status === 'sold').length)}
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      <SectionTitle className="mt-8">About this build</SectionTitle>
      <p className="mt-2 max-w-3xl text-xs text-muted">
        Money and points are integers end-to-end; every purchase is validated and written inside a
        single atomic database write, and retries reuse the same request id so a team can never be
        charged twice. See <code className="rounded bg-surface-muted px-1 py-0.5">docs/SECURITY.md</code> for the
        full data-protection model.
      </p>

      <Dialog
        open={reopenOpen}
        onClose={() => setReopenOpen(false)}
        title="Reopen the finalized auction"
        description="Reopening allows new purchases again. This is logged with your reason."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>
              Cancel
            </Button>
            <Button loading={reopenBusy} disabled={reopenReason.trim().length < 3} onClick={() => void reopen()}>
              Reopen auction
            </Button>
          </>
        }
      >
        <TextareaField
          label="Reason for reopening"
          value={reopenReason}
          maxLength={240}
          autoFocus
          onChange={(event) => setReopenReason(event.target.value)}
          hint="Stored in the audit log."
        />
      </Dialog>
    </div>
  )
}
