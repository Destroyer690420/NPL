import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { InputField, TextareaField } from '@/components/ui/Field'
import { formatAmount, parseAmountInput, parseIntegerInput } from '@shared/money'
import { MAX_AMOUNT } from '@shared/constants'
import { currency } from '@/lib/format'
import type { TeamDoc } from '@shared/types'

export interface TeamFormValues {
  name: string
  startingPurse: number
  logoUrl: string | null
  reason?: string | null
}

/**
 * Create/edit team dialog. In edit mode a reason is required when the starting
 * purse changes (the server enforces the same rule).
 */
export function TeamFormDialog({
  open,
  onClose,
  onSubmit,
  team,
  defaultStartingPurse,
  currencyLabel,
  submitting,
  error,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (values: TeamFormValues) => void
  team?: TeamDoc | null
  defaultStartingPurse: number
  currencyLabel: string
  submitting: boolean
  error: string | null
}) {
  const editing = Boolean(team)
  const [name, setName] = useState('')
  const [purse, setPurse] = useState('')
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const wasOpenRef = useRef(false)
  const lastTeamIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      lastTeamIdRef.current = null
      return
    }
    const currentTeamId = team ? team.id : '__new__'
    if (!wasOpenRef.current || lastTeamIdRef.current !== currentTeamId) {
      wasOpenRef.current = true
      lastTeamIdRef.current = currentTeamId
      setLocalError(null)
      setReason('')
      if (team) {
        setName(team.name)
        setPurse(String(team.startingPurse))
      } else {
        setName('')
        setPurse(String(defaultStartingPurse))
      }
    }
  }, [open, team, defaultStartingPurse])

  const purseChanged = team ? parseAmountInput(purse, true) !== team.startingPurse : false
  const needsReason = editing && purseChanged

  function submit(): void {
    const trimmed = name.trim()
    const rawPurse = parseIntegerInput(purse)
    if (trimmed === '') {
      setLocalError('Enter a team name.')
      return
    }
    if (rawPurse === null || rawPurse < 0) {
      setLocalError('Starting purse must be a whole number of 0 or more.')
      return
    }
    if (rawPurse > MAX_AMOUNT) {
      setLocalError(`Starting purse cannot exceed ${formatAmount(MAX_AMOUNT, currencyLabel)}.`)
      return
    }
    const amount = rawPurse
    if (needsReason && reason.trim().length < 3) {
      setLocalError('Enter a reason (at least 3 characters) for changing the starting purse.')
      return
    }
    onSubmit({
      name: trimmed,
      startingPurse: amount,
      logoUrl: null,
      reason: needsReason ? reason.trim() : null,
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${team?.name}` : 'Add team'}
      description={
        editing
          ? 'Changing the starting purse rebuilds the remaining purse from what the team has already spent.'
          : `New teams get a four-digit PIN. The default starting purse is ${currency(defaultStartingPurse, currencyLabel)}.`
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submitting} onClick={submit}>
            {editing ? 'Save changes' : 'Create team'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <InputField
          label="Team name"
          value={name}
          maxLength={80}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Team Alpha"
        />
        <InputField
          label="Starting purse"
          value={purse}
          inputMode="numeric"
          onChange={(event) => setPurse(event.target.value)}
          hint={
            editing
              ? `Currently spent: ${currency(team?.totalSpent ?? 0, currencyLabel)}. Cannot be lower than that.`
              : 'Whole numbers only.'
          }
        />
        {needsReason ? (
          <TextareaField
            label="Reason for the purse change"
            value={reason}
            maxLength={240}
            onChange={(event) => setReason(event.target.value)}
            hint="Stored in the audit log."
          />
        ) : null}
        {localError ?? error ? (
          <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            {localError ?? error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
