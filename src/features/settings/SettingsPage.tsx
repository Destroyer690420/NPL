import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Flag,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  Save,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminAuth } from '@/auth/AdminAuthProvider'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, usePublicConfig, usePurchases, useTeams } from '@/data/hooks'
import { PageHeader, SectionTitle } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, InputField, TextareaField } from '@/components/ui/Field'
import { EventStatusPill, Pill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { checkEventConsistency, createPlayer, resetEventData, setDefaultEvent, updateEvent } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { downloadCsv } from '@/lib/csv'
import { PlayerFormDialog, type PlayerFormValues } from '@/features/players/PlayerFormDialog'
import { PlayerImportDialog } from '@/features/players/PlayerImportDialog'
import { formatAmount, parseAmountInput, parseIntegerInput } from '@shared/money'
import { MAX_ROSTER_SIZE_LIMIT, MAX_AMOUNT } from '@shared/constants'
import { formatDateTime, formatRelative, points as formatPoints } from '@/lib/format'

export function SettingsPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const auth = useAdminAuth()
  const toast = useToast()
  const teams = useTeams(eventId)
  const players = usePlayers(eventId)
  const purchases = usePurchases(eventId, 500)
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

  const [playerImportOpen, setPlayerImportOpen] = useState(false)
  const [playerFormOpen, setPlayerFormOpen] = useState(false)
  const [playerSubmitting, setPlayerSubmitting] = useState(false)
  const [playerFormError, setPlayerFormError] = useState<string | null>(null)

  const [resetOpen, setResetOpen] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  const loadedEventRef = useRef<string | null>(null)
  const isDirtyRef = useRef(false)

  useEffect(() => {
    if (!event) return
    if (loadedEventRef.current !== event.id || (!isDirtyRef.current && !saving)) {
      loadedEventRef.current = event.id
      setName(event.name)
      setCurrencyLabel(event.currencyLabel === 'credits' ? '₹' : event.currencyLabel)
      setDefaultPurse(String(event.defaultStartingPurse))
      setMaxRoster(event.maxRosterSize === null ? '' : String(event.maxRosterSize))
      setPurchasesEnabled(event.purchasesEnabled)
    }
  }, [event, saving])

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

  isDirtyRef.current = dirty

  async function save(): Promise<void> {
    if (!event) return
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
    const rawPurse = parseIntegerInput(defaultPurse)
    if (rawPurse === null || rawPurse < 0) {
      setFormError('Default starting purse must be a whole number of 0 or more.')
      return
    }
    if (rawPurse > MAX_AMOUNT) {
      setFormError(`Default starting purse cannot exceed ${formatAmount(MAX_AMOUNT, currencyLabel.trim())}.`)
      return
    }
    const purse = rawPurse
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
      isDirtyRef.current = false
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

  async function submitPlayer(values: PlayerFormValues): Promise<void> {
    setPlayerSubmitting(true)
    setPlayerFormError(null)
    try {
      await createPlayer({
        eventId,
        name: values.name,
        points: values.points,
        basePrice: values.basePrice,
        photoUrl: values.photoUrl,
        externalReference: values.externalReference,
        notes: values.notes,
        status: values.status ?? 'available',
      })
      toast.push({ kind: 'success', message: `${values.name} added to the pool.` })
      setPlayerFormOpen(false)
    } catch (error) {
      setPlayerFormError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setPlayerSubmitting(false)
    }
  }

  function exportCsv(): void {
    const teamNames = new Map(teams.data.map((team) => [team.id, team.name]))
    const rows: Array<Array<string | number>> = [
      ['player_id', 'name', 'points', 'base_price', 'status', 'sold_to'],
      ...players.data.map((player) => [
        player.externalReference ?? '',
        player.name,
        player.points,
        player.basePrice,
        player.status,
        player.soldToTeamId ? (teamNames.get(player.soldToTeamId) ?? player.soldToTeamId) : '',
      ]),
    ]
    downloadCsv(`players-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  function exportTransactionsCsv(): void {
    const rows: Array<Array<string | number>> = [
      ['purchase_id', 'time', 'player', 'points', 'team', 'final_price', 'status', 'reversal_reason'],
      ...purchases.data.map((purchase) => [
        purchase.id,
        formatDateTime(purchase.createdAt),
        purchase.playerNameSnapshot,
        purchase.playerPointsSnapshot,
        purchase.teamNameSnapshot,
        purchase.finalPrice,
        purchase.status,
        purchase.reversalReason ?? '',
      ]),
    ]
    downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, rows)
  }

  async function handleResetEvent(): Promise<void> {
    if (!eventId || resetConfirmText.trim() !== 'DELETE') return
    try {
      setResetBusy(true)
      await resetEventData(eventId)
      toast.push({
        kind: 'success',
        message: 'All event data has been reset.',
        detail: 'Teams, players, purchases, and audit logs have been wiped. Event status reset to draft.',
      })
      setResetOpen(false)
      setResetConfirmText('')
    } catch (err) {
      toast.push({
        kind: 'error',
        message: 'Failed to reset event data.',
        detail: errorMessage(err),
      })
    } finally {
      setResetBusy(false)
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
              Run consistency check
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
          <CardBody>
            <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
              <InputField label="Event name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <InputField
                  label="Currency label"
                  value={currencyLabel}
                  maxLength={12}
                  onChange={(e) => setCurrencyLabel(e.target.value)}
                  hint="e.g. ₹ — shown in front of all amounts"
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
                <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm font-semibold text-rose-300">
                  {formError}
                </p>
              ) : null}

              <div className="flex items-center justify-between border-t border-line/60 pt-4">
                <span className="text-xs text-muted">
                  {dirty ? 'You have unsaved changes' : 'All changes saved'}
                </span>
                <div className="flex items-center gap-2">
                  {dirty ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={saving}
                      onClick={() => {
                        if (!event) return
                        setName(event.name)
                        setCurrencyLabel(event.currencyLabel)
                        setDefaultPurse(String(event.defaultStartingPurse))
                        setMaxRoster(event.maxRosterSize === null ? '' : String(event.maxRosterSize))
                        setPurchasesEnabled(event.purchasesEnabled)
                        setFormError(null)
                      }}
                    >
                      Discard
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    icon={<Save className="size-4" aria-hidden />}
                    disabled={!dirty}
                    loading={saving}
                  >
                    Save changes
                  </Button>
                </div>
              </div>
            </form>
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
                  <p className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                    <CheckCircle2 className="size-4 text-emerald-400" aria-hidden />
                    All totals reconcile with the purchase records.
                  </p>
                ) : (
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-rose-300">
                      <AlertTriangle className="size-4 text-rose-400" aria-hidden />
                      {report.problems.length} problem{report.problems.length === 1 ? '' : 's'} found
                    </p>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-rose-300">
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

          <Card>
            <CardHeader>
              <CardTitle>Player pool</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">
                Import, create, or export player entries for the auction pool.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FileUp className="size-3.5" aria-hidden />}
                  onClick={() => setPlayerImportOpen(true)}
                >
                  Import CSV
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download className="size-3.5" aria-hidden />}
                  onClick={exportCsv}
                  disabled={players.data.length === 0}
                >
                  Export CSV
                </Button>
                <Button
                  size="sm"
                  icon={<PlusCircle className="size-3.5" aria-hidden />}
                  onClick={() => {
                    setPlayerFormError(null)
                    setPlayerFormOpen(true)
                  }}
                >
                  Add player
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Transactions history</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">
                Export all purchase and reversal records for audit or accounting.
              </p>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download className="size-3.5" aria-hidden />}
                onClick={exportTransactionsCsv}
                disabled={purchases.data.length === 0}
              >
                Export transactions CSV
              </Button>
            </CardBody>
          </Card>

          <Card className="border-danger/30 bg-danger/5">
            <CardHeader>
              <CardTitle className="text-danger flex items-center gap-2">
                <AlertTriangle className="size-4" aria-hidden />
                Danger zone
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-muted">
                Permanently delete all teams, players, transactions, and audit records for this event. This action is irreversible.
              </p>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="size-3.5" aria-hidden />}
                onClick={() => {
                  setResetConfirmText('')
                  setResetOpen(true)
                }}
              >
                Delete all event data
              </Button>
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

      <PlayerImportDialog
        open={playerImportOpen}
        onClose={() => setPlayerImportOpen(false)}
        eventId={eventId}
        currencyLabel={currencyLabel}
        onImported={(imported, skipped) => {
          toast.push({
            kind: 'success',
            message: `${imported} player${imported === 1 ? '' : 's'} imported.`,
            detail: skipped.length > 0 ? `${skipped.length} existing player id(s) skipped.` : undefined,
          })
        }}
      />

      <PlayerFormDialog
        open={playerFormOpen}
        onClose={() => setPlayerFormOpen(false)}
        onSubmit={(values) => void submitPlayer(values)}
        currencyLabel={currencyLabel}
        submitting={playerSubmitting}
        error={playerFormError}
      />

      <Dialog
        open={resetOpen}
        onClose={() => !resetBusy && setResetOpen(false)}
        title="Delete all event data"
        description="This will permanently delete all teams, players, purchases, PINs, and audit logs for this event. There is no recovery."
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={resetBusy} onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={resetBusy}
              disabled={resetConfirmText.trim() !== 'DELETE'}
              onClick={() => void handleResetEvent()}
            >
              Permanently delete everything
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <p className="font-semibold">Warning: This action cannot be undone.</p>
            <p className="mt-1 text-ink-soft">
              All rosters, sold player records, team balances, and PINs will be permanently wiped. The event will be reset to draft state.
            </p>
          </div>
          <InputField
            label="Type DELETE to confirm"
            placeholder="DELETE"
            value={resetConfirmText}
            autoFocus
            onChange={(e) => setResetConfirmText(e.target.value)}
            hint="Case-sensitive confirmation required."
          />
        </div>
      </Dialog>
    </div>
  )
}
