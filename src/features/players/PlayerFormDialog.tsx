import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, InputField, SelectField, TextareaField } from '@/components/ui/Field'
import { parseAmountInput, parsePointsInput } from '@shared/money'
import type { PlayerDoc } from '@shared/types'

export interface PlayerFormValues {
  name: string
  points: number
  basePrice: number
  photoUrl: string | null
  externalReference: string | null
  notes: string | null
  /** null for sold players (their status is locked until the purchase is reversed). */
  status: 'available' | 'withdrawn' | null
  reason: string | null
}

/**
 * Create/edit player dialog.
 *
 * A sold player can be corrected (name, points, price, photo) but the status
 * is locked until the purchase is reversed; changing points or the base price
 * of a sold player additionally requires a reason and updates team totals
 * atomically on the server.
 */
export function PlayerFormDialog({
  open,
  onClose,
  onSubmit,
  player,
  soldToTeamName,
  currencyLabel,
  submitting,
  error,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (values: PlayerFormValues) => void
  player?: PlayerDoc | null
  soldToTeamName?: string | null
  currencyLabel: string
  submitting: boolean
  error: string | null
}) {
  const editing = Boolean(player)
  const sold = player?.status === 'sold'

  const [name, setName] = useState('')
  const [points, setPoints] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [externalReference, setExternalReference] = useState('')
  const [notes, setNotes] = useState('')
  const [withdrawn, setWithdrawn] = useState(false)
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const wasOpenRef = useRef(false)
  const lastPlayerIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      lastPlayerIdRef.current = null
      return
    }
    const currentPlayerId = player ? player.id : '__new__'
    if (!wasOpenRef.current || lastPlayerIdRef.current !== currentPlayerId) {
      wasOpenRef.current = true
      lastPlayerIdRef.current = currentPlayerId
      setLocalError(null)
      setReason('')
      if (player) {
        setName(player.name)
        setPoints(String(player.points))
        setBasePrice(String(player.basePrice))
        setPhotoUrl(player.photoUrl ?? '')
        setExternalReference(player.externalReference ?? '')
        setNotes(player.notes ?? '')
        setWithdrawn(player.status === 'withdrawn')
      } else {
        setName('')
        setPoints('')
        setBasePrice('')
        setPhotoUrl('')
        setExternalReference('')
        setNotes('')
        setWithdrawn(false)
      }
    }
  }, [open, player])

  const nextPoints = parsePointsInput(points)
  const nextPrice = parseAmountInput(basePrice, true)
  const soldChangesTotals =
    sold && ((nextPoints !== null && nextPoints !== player?.points) || (nextPrice !== null && nextPrice !== player?.basePrice))
  const needsReason = soldChangesTotals

  function submit(): void {
    const trimmed = name.trim()
    if (trimmed === '') {
      setLocalError('Enter the player name.')
      return
    }
    if (nextPoints === null) {
      setLocalError('Points must be a whole number of 0 or more.')
      return
    }
    if (nextPrice === null) {
      setLocalError('Base price must be a whole number of 0 or more.')
      return
    }
    const trimmedPhoto = photoUrl.trim()
    if (trimmedPhoto !== '' && !/^https?:\/\//i.test(trimmedPhoto)) {
      setLocalError('Photo URL must start with http:// or https://.')
      return
    }
    if (needsReason && reason.trim().length < 3) {
      setLocalError('Changing a sold player requires a reason (at least 3 characters).')
      return
    }
    onSubmit({
      name: trimmed,
      points: nextPoints,
      basePrice: nextPrice,
      photoUrl: trimmedPhoto === '' ? null : trimmedPhoto,
      externalReference: externalReference.trim() === '' ? null : externalReference.trim(),
      notes: notes.trim() === '' ? null : notes.trim(),
      status: sold ? null : withdrawn ? 'withdrawn' : 'available',
      reason: needsReason ? reason.trim() : null,
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${player?.name}` : 'Add player'}
      description={
        sold
          ? `Sold to ${soldToTeamName ?? 'a team'} — corrections update the team's points atomically and are audited.`
          : undefined
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submitting} onClick={submit}>
            {editing ? 'Save changes' : 'Add player'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Player name"
            value={name}
            maxLength={80}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Rohit Sharma"
          />
          <InputField
            label="Player ID"
            optional
            value={externalReference}
            maxLength={120}
            onChange={(event) => setExternalReference(event.target.value)}
            hint="Used by CSV import to match your sheets"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <InputField
            label="Points"
            value={points}
            inputMode="numeric"
            onChange={(event) => setPoints(event.target.value)}
            hint="Squad points this player contributes"
          />
          <InputField
            label={`Base / reference price (${currencyLabel})`}
            value={basePrice}
            inputMode="numeric"
            onChange={(event) => setBasePrice(event.target.value)}
          />
        </div>
        <InputField
          label="Photo URL"
          optional
          value={photoUrl}
          onChange={(event) => setPhotoUrl(event.target.value)}
          placeholder="https://…"
        />
        {!sold ? (
          <SelectField
            label="Status"
            value={withdrawn ? 'withdrawn' : 'available'}
            onChange={(event) => setWithdrawn(event.target.value === 'withdrawn')}
          >
            <option value="available">Available</option>
            <option value="withdrawn">Withdrawn</option>
          </SelectField>
        ) : null}
        <TextareaField
          label="Notes"
          optional
          value={notes}
          maxLength={500}
          onChange={(event) => setNotes(event.target.value)}
          hint="Internal note shown to admins only."
        />
        {needsReason ? (
          <TextareaField
            label="Reason for correcting this sold player"
            value={reason}
            maxLength={240}
            onChange={(event) => setReason(event.target.value)}
            hint="Stored in the audit log and required for points/price changes."
          />
        ) : null}
        {!editing ? (
          <CheckboxField
            label="Withdraw immediately"
            description="Withdrawn players stay in the pool but cannot be sold."
            checked={withdrawn}
            onChange={setWithdrawn}
          />
        ) : null}
        {localError ?? error ? (
          <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm font-semibold text-rose-300">
            {localError ?? error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
