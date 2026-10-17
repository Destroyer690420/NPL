import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { Building2, Plus, Search } from 'lucide-react'
import type { AdminOutletContext } from '@/app/outlet'
import { useAdminEvent } from '@/app/AdminEventProvider'
import { useTeams } from '@/data/hooks'
import { currency, points as formatPoints } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { InputField } from '@/components/ui/Field'
import { EmptyState, Skeleton } from '@/components/ui/Feedback'
import { Pill } from '@/components/ui/StatusPill'
import { useToast } from '@/components/ui/Toast'
import { createTeam } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { normalizeName } from '@shared/text'
import { TeamFormDialog, type TeamFormValues } from './TeamFormDialog'
import { PinRevealDialog } from './PinRevealDialog'

export function TeamsPage() {
  const { eventId } = useOutletContext<AdminOutletContext>()
  const { event } = useAdminEvent()
  const toast = useToast()
  const teams = useTeams(eventId)

  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [reveal, setReveal] = useState<{ teamName: string; pin: string } | null>(null)

  const currencyLabel = event?.currencyLabel ?? '₹'

  const filtered = useMemo(() => {
    const term = normalizeName(search)
    const list = term
      ? teams.data.filter((team) => normalizeName(team.name).includes(term))
      : teams.data
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [teams.data, search])

  async function create(values: TeamFormValues): Promise<void> {
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await createTeam({
        eventId,
        name: values.name,
        startingPurse: values.startingPurse,
        logoUrl: values.logoUrl,
      })
      setFormOpen(false)
      setReveal({ teamName: result.name, pin: result.pin })
    } catch (error) {
      setFormError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Each team gets a private PIN login where members can follow their purse and roster live."
        actions={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setFormOpen(true)}>
            Add team
          </Button>
        }
      />

      <Card>
        <CardBody className="pb-3">
          <InputField
            label="Search teams"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Type a team name…"
            aria-label="Search teams"
          />
        </CardBody>

        {teams.loading ? (
          <CardBody className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardBody>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-8" aria-hidden />}
            title={teams.data.length === 0 ? 'No teams yet' : 'No teams match that search'}
            description={
              teams.data.length === 0
                ? 'Add at least one team before starting the auction.'
                : 'Try a different name.'
            }
            action={
              teams.data.length === 0 ? (
                <Button size="sm" onClick={() => setFormOpen(true)} icon={<Plus className="size-3.5" aria-hidden />}>
                  Add the first team
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 sm:px-5">Team</th>
                  <th className="px-3 py-2.5 text-right">Remaining purse</th>
                  <th className="hidden px-3 py-2.5 text-right sm:table-cell">Spent</th>
                  <th className="hidden px-3 py-2.5 text-right md:table-cell">Points</th>
                  <th className="px-3 py-2.5 text-right">Players</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-4 py-2.5 sm:px-5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((team) => (
                  <tr key={team.id} className="hover:bg-surface-muted/60">
                    <td className="px-4 py-3 sm:px-5">
                      <Link to={`/admin/teams/${team.id}`} className="font-semibold text-ink hover:text-accent hover:underline">
                        {team.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-accent">
                      {currency(team.remainingPurse, currencyLabel)}
                      <span className="block text-[11px] font-normal text-muted">
                        of {currency(team.startingPurse, currencyLabel)}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">
                      {currency(team.totalSpent, currencyLabel)}
                    </td>
                    <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">
                      {formatPoints(team.totalPoints)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{team.playerCount}</td>
                    <td className="px-3 py-3">
                      {team.active ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      <Link to={`/admin/teams/${team.id}`} className="text-xs font-medium text-accent hover:underline">
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 flex items-center gap-2 text-xs text-muted">
        <Search className="size-3.5" aria-hidden />
        {filtered.length} of {teams.data.length} teams shown
      </div>

      <TeamFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={(values) => void create(values)}
        defaultStartingPurse={event?.defaultStartingPurse ?? 0}
        currencyLabel={currencyLabel}
        submitting={submitting}
        error={formError}
      />

      {reveal ? (
        <PinRevealDialog
          open
          teamName={reveal.teamName}
          pin={reveal.pin}
          onDone={() => {
            setReveal(null)
            toast.push({ kind: 'success', message: 'Team created.' })
          }}
        />
      ) : null}
    </div>
  )
}
