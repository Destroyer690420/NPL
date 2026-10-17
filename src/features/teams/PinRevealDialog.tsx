import { useEffect, useState } from 'react'
import { Copy, KeyRound, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'

/**
 * Shows a freshly generated team PIN exactly once. The dialog cannot be
 * dismissed accidentally (no backdrop/Escape close) because the PIN can never
 * be shown again — only reset.
 */
export function PinRevealDialog({
  open,
  teamName,
  pin,
  onDone,
}: {
  open: boolean
  teamName: string
  pin: string
  onDone: () => void
}) {
  const toast = useToast()
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    if (open) setAcknowledged(false)
  }, [open])

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(pin)
      toast.push({ kind: 'success', message: 'PIN copied to the clipboard.' })
    } catch {
      toast.push({ kind: 'info', message: 'Copy the PIN manually — the clipboard is unavailable.' })
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onDone}
      dismissible={false}
      title={`${teamName} — new PIN`}
      description="Share this PIN with the team now. It is stored hashed and can never be shown again."
      size="sm"
      footer={
        <Button disabled={!acknowledged} onClick={onDone}>
          I have saved the PIN
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="flex items-center gap-3">
          <span className="select-all rounded-control border border-line bg-surface-muted px-5 py-3 text-3xl font-bold tracking-[0.35em] tabular-nums text-ink">
            {pin}
          </span>
          <Button variant="secondary" onClick={() => void copy()} icon={<Copy className="size-4" aria-hidden />}>
            Copy
          </Button>
        </div>
        <div className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2 text-xs text-warn">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
            Anyone with this PIN can view {teamName}'s purse and roster. The team logs in at the{' '}
            <code>/team</code> page. Resetting the PIN signs the team out everywhere.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          <span className="flex items-center gap-1">
            <KeyRound className="size-3.5" aria-hidden />I understand this PIN will not be shown again
          </span>
        </label>
      </div>
    </Dialog>
  )
}
