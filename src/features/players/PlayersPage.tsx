import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router'
import { Ban, Download, FileUp, PlusCircle, Search, UserRound } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { usePlayers, useTeams } from '@/data/hooks'
import { currency, points as formatPoints } from '@/lib/format'
import { normalizeName } from '@shared/text'
import type { PlayerDoc, PlayerStatus } from '@shared/types'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { InputField, SelectField } from '@/components/ui/Field'
import { EmptyState, LoadingBlock } from '@/components/ui/Feedback'
import { PlayerStatusPill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { createPlayer, setPlayerStatus, updatePlayer } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { downloadCsv } from '@/lib/csv'
import { PlayerFormDialog, type PlayerFormValues } from './PlayerFormDialog'
import { PlayerImportDialog } from './PlayerImportDialog'

type StatusFilter = 'all' | PlayerStatus
type SortKey = 'name' | 'points' | 'basePrice' | 'status'

const PAGE_SIZE = 100

export function PlayersPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const toast = useToast()

  const players = usePlayers(eventId)
  const teams = useTeams(eventId)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PlayerDoc | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)

  const currencyLabel = event?.currencyLabel ?? 'credits'
  const teamNames = useMemo(() => new Map(teams.data.map((team) => [team.id, team.name])), [teams.data])

  const filtered = useMemo(() => {
    const term = normalizeName(search)
    const list = players.data.filter((player) => {
      if (statusFilter !== 'all' && player.status !== statusFilter) return false
      if (term === '') return true
      return normalizeName(`${player.name} ${player.externalReference ?? ''}`).includes(term)
    })
    const sorted = [...list]
    if (sortKey === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortKey === 'points') sorted.sort((a, b) => b.points - a.points)
    else if (sortKey === 'basePrice') sorted.sort((a, b) => b.basePrice - a.basePrice)
    else sorted.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name))
    return sorted
  }, [players.data, search, statusFilter, sortKey])

  const shown = filtered.slice(0, visible)

  function openCreate(): void {
    setEditing(null)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(player: PlayerDoc): void {
    setEditing(player)
    setFormError(null)
    setFormOpen(true)
  }

  async function save(values: PlayerFormValues): Promise<void> {
    setSubmitting(true)
    setFormError(null)
    try {
      if (editing) {
        await updatePlayer({
          eventId,
          playerId: editing.id,
          name: values.name,
          points: values.points,
          basePrice: values.basePrice,
          photoUrl: values.photoUrl,
          externalReference: values.externalReference,
          notes: values.notes,
          status: values.status ?? undefined,
          reason: values.reason,
        })
        toast.push({
          kind: 'success',
          message: `${values.name} updated.`,
          detail: editing.status === 'sold' ? 'Team totals were re-derived atomically.' : undefined,
        })
      } else {
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
      }
      setFormOpen(false)
    } catch (error) {
      setFormError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleStatus(player: PlayerDoc): Promise<void> {
    setActionBusyId(player.id)
    try {
      const next = player.status === 'withdrawn' ? 'available' : 'withdrawn'
      await setPlayerStatus(eventId, player.id, next)
      toast.push({
        kind: 'success',
        message: next === 'withdrawn' ? `${player.name} withdrawn.` : `${player.name} is available again.`,
      })
    } catch (error) {
      toast.push({ kind: 'error', message: isCallError(error) ? error.message : errorMessage(error) })
    } finally {
      setActionBusyId(null)
    }
  }

  function exportCsv(): void {
    const rows: Array<Array<string | number>> = [
      ['player_id', 'name', 'points', 'base_price', 'status', 'sold_to'],
      ...filtered.map((player) => [
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

  return (
    <div>
      <PageHeader
        title="Players"
        description="The auction pool. Sold players are locked until their purchase is reversed."
        actions={
          <>
            <Button variant="secondary" icon={<FileUp className="size-4" aria-hidden />} onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button variant="secondary" icon={<Download className="size-4" aria-hidden />} onClick={exportCsv} disabled={filtered.length === 0}>
              Export CSV
            </Button>
            <Button icon={<PlusCircle className="size-4" aria-hidden />} onClick={openCreate}>
              Add player
            </Button>
          </>
        }
      />

      <Card>
        <CardBody className="grid gap-3 pb-3 sm:grid-cols-[1fr_170px_170px]">
          <InputField
            label="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setVisible(PAGE_SIZE)
            }}
            placeholder="Name or player ID…"
          />
          <SelectField
            label="Status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter)
              setVisible(PAGE_SIZE)
            }}
          >
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="sold">Sold</option>
            <option value="withdrawn">Withdrawn</option>
          </SelectField>
          <SelectField label="Sort by" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="points">Points (high → low)</option>
            <option value="basePrice">Base price (high → low)</option>
            <option value="status">Status</option>
          </SelectField>
        </CardBody>

        {players.loading ? (
          <LoadingBlock label="Loading players…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<UserRound className="size-8" aria-hidden />}
            title={players.data.length === 0 ? 'No players yet' : 'No players match the filters'}
            description={
              players.data.length === 0
                ? 'Add players one by one or import a CSV in one go.'
                : 'Adjust the search or status filter.'
            }
            action={
              players.data.length === 0 ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={openCreate}>
                    Add player
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
                    Import CSV
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5 sm:px-5">Player</th>
                    <th className="px-3 py-2.5 text-right">Points</th>
                    <th className="px-3 py-2.5 text-right">Base price</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="hidden px-3 py-2.5 md:table-cell">Owner</th>
                    <th className="px-4 py-2.5 text-right sm:px-5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((player) => (
                    <tr key={player.id} className="hover:bg-surface-muted/60">
                      <td className="px-4 py-3 sm:px-5">
                        <button
                          type="button"
                          onClick={() => openEdit(player)}
                          className="text-left font-medium text-ink hover:text-accent hover:underline"
                        >
                          {player.name}
                        </button>
                        {player.externalReference ? (
                          <span className="block text-[11px] text-muted">{player.externalReference}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatPoints(player.points)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{currency(player.basePrice, currencyLabel)}</td>
                      <td className="px-3 py-3">
                        <PlayerStatusPill status={player.status} />
                      </td>
                      <td className="hidden px-3 py-3 text-muted md:table-cell">
                        {player.soldToTeamId ? (teamNames.get(player.soldToTeamId) ?? '—') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(player)}>
                            Edit
                          </Button>
                          {player.status !== 'sold' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={actionBusyId === player.id}
                              icon={
                                player.status === 'withdrawn' ? (
                                  <PlusCircle className="size-3.5" aria-hidden />
                                ) : (
                                  <Ban className="size-3.5" aria-hidden />
                                )
                              }
                              onClick={() => void toggleStatus(player)}
                            >
                              {player.status === 'withdrawn' ? 'Reactivate' : 'Withdraw'}
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
                {filtered.length} player{filtered.length === 1 ? '' : 's'} match
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

      <PlayerFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={(values) => void save(values)}
        player={editing}
        soldToTeamName={editing?.soldToTeamId ? (teamNames.get(editing.soldToTeamId) ?? null) : null}
        currencyLabel={currencyLabel}
        submitting={submitting}
        error={formError}
      />

      <PlayerImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
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
    </div>
  )
}
