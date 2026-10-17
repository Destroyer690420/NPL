import { useState } from 'react'
import { PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { InputField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAdminAuth } from '@/auth/AdminAuthProvider'
import { createEvent } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'
import { parseAmountInput } from '@shared/money'
import { DEFAULT_CURRENCY_LABEL, DEFAULT_EVENT_NAME, DEFAULT_STARTING_PURSE } from '@shared/constants'
import { useAdminEvent } from '@/app/AdminEventProvider'

/**
 * First-run screen: no event document exists yet, so creation is the only
 * possible action. All values can be changed later in Settings.
 */
export function CreateEventPanel() {
  const auth = useAdminAuth()
  const { setEventId } = useAdminEvent()
  const toast = useToast()

  const [name, setName] = useState(DEFAULT_EVENT_NAME)
  const [currencyLabel, setCurrencyLabel] = useState(DEFAULT_CURRENCY_LABEL)
  const [purse, setPurse] = useState(String(DEFAULT_STARTING_PURSE))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(): Promise<void> {
    setError(null)
    const trimmedName = name.trim()
    const trimmedCurrency = currencyLabel.trim()
    const amount = parseAmountInput(purse, true)
    if (trimmedName === '') {
      setError('Enter an event name.')
      return
    }
    if (trimmedCurrency === '') {
      setError('Enter a currency or credit label.')
      return
    }
    if (amount === null) {
      setError('Starting purse must be a whole number of 0 or more.')
      return
    }
    setSubmitting(true)
    try {
      const result = await createEvent({
        name: trimmedName,
        currencyLabel: trimmedCurrency,
        defaultStartingPurse: amount,
      })
      setEventId(result.eventId)
      toast.push({
        kind: 'success',
        message: 'Event created.',
        detail: 'Add your teams and players next.',
      })
    } catch (caught) {
      setError(isCallError(caught) ? caught.message : errorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-12">
      <Card>
        <CardBody className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              {auth.displayName}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink">Create your auction event</h1>
            <p className="mt-1 text-sm text-ink-soft">
              One event holds the teams, the player pool and every purchase. You can edit all of
              this later in Settings.
            </p>
          </div>
          <InputField
            label="Event name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. College Premier League Auction"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <InputField
              label="Currency label"
              value={currencyLabel}
              maxLength={12}
              onChange={(event) => setCurrencyLabel(event.target.value)}
              hint="e.g. ₹ or credits"
            />
            <InputField
              label="Default starting purse"
              value={purse}
              inputMode="numeric"
              onChange={(event) => setPurse(event.target.value)}
              hint="Pre-fills new teams"
            />
          </div>
          {error ? (
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button
            block
            size="lg"
            loading={submitting}
            icon={<PlusCircle className="size-4" aria-hidden />}
            onClick={() => void submit()}
          >
            Create event
          </Button>
          <button
            type="button"
            className="mx-auto text-xs text-muted underline-offset-2 hover:underline"
            onClick={() => void auth.signOut()}
          >
            Sign out
          </button>
        </CardBody>
      </Card>
    </main>
  )
}
