import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { CheckboxField, SelectField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { downloadCsv, downloadText, readFileAsText } from '@/lib/csv'
import {
  buildErrorReportCsv,
  buildPlayerImportPreview,
  PLAYER_CSV_TEMPLATE,
  toImportPayload,
  type PlayerImportPreview,
} from './playerImport'
import { importPlayers } from '@/services/admin'
import { isCallError } from '@/services/callables'
import { errorMessage } from '@/lib/errors'

/**
 * CSV import flow: choose a file, inspect every row (line numbers, precise
 * errors, duplicates), then commit explicitly. Invalid rows are never skipped
 * silently — importing around them requires an explicit acknowledgement.
 */
export function PlayerImportDialog({
  open,
  onClose,
  eventId,
  currencyLabel,
  onImported,
}: {
  open: boolean
  onClose: () => void
  eventId: string
  currencyLabel: string
  onImported: (imported: number, skipped: string[]) => void
}) {
  const toast = useToast()
  const [fileName, setFileName] = useState<string | null>(null)
  const [preview, setPreview] = useState<PlayerImportPreview | null>(null)
  const [skippingInvalid, setSkippingInvalid] = useState(false)
  const [duplicateMode, setDuplicateMode] = useState<'fail' | 'skip-duplicates'>('fail')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)

  const previewRows = useMemo(() => preview?.rows.slice(0, 200) ?? [], [preview])

  function reset(): void {
    setFileName(null)
    setPreview(null)
    setSkippingInvalid(false)
    setDuplicateMode('fail')
    setCommitError(null)
  }

  async function onFile(file: File | null): Promise<void> {
    if (!file) return
    try {
      const text = await readFileAsText(file)
      const result = buildPlayerImportPreview(text)
      setPreview(result)
      setFileName(file.name)
      setSkippingInvalid(false)
      setCommitError(null)
    } catch {
      toast.push({ kind: 'error', message: 'Could not read that file.' })
    }
  }

  const commitDisabled =
    committing ||
    !preview ||
    preview.missingColumns.length > 0 ||
    preview.validCount === 0 ||
    (preview.invalidCount > 0 && !skippingInvalid)

  async function commit(): Promise<void> {
    if (!preview) return
    setCommitting(true)
    setCommitError(null)
    try {
      const payload = toImportPayload(preview.rows, 'all-valid-rows')
      const result = await importPlayers(eventId, payload, duplicateMode)
      onImported(result.imported, result.skipped)
      reset()
      onClose()
    } catch (error) {
      setCommitError(isCallError(error) ? error.message : errorMessage(error))
    } finally {
      setCommitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Import players from CSV"
      description="Columns: player_id, name, points, base_price. The whole file is validated before anything is written."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => downloadText('players-template.csv', PLAYER_CSV_TEMPLATE)}>
            Download template
          </Button>
          <Button
            variant="secondary"
            disabled={!preview || preview.rows.every((row) => row.errors.length === 0)}
            onClick={() => preview && downloadCsv('player-import-errors.csv', buildErrorReportCsv(preview.rows))}
          >
            Error report
          </Button>
          <Button disabled={commitDisabled} loading={committing} icon={<Upload className="size-4" aria-hidden />} onClick={() => void commit()}>
            {preview && preview.invalidCount > 0
              ? `Import ${preview.validCount} valid row${preview.validCount === 1 ? '' : 's'}`
              : `Import ${preview?.validCount ?? 0} players`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-surface-muted px-4 py-6 text-center transition-colors hover:border-accent">
          <FileUp className="size-6 text-muted" aria-hidden />
          <span className="text-sm font-medium text-ink">
            {fileName ?? 'Choose a CSV file'}
          </span>
          <span className="text-xs text-muted">or drag it onto this area</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {preview ? (
          <div className="space-y-3">
            {preview.missingColumns.length > 0 ? (
              <div className="flex items-start gap-2 rounded-control border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Missing required column{preview.missingColumns.length === 1 ? '' : 's'}:{' '}
                  <span className="font-medium">{preview.missingColumns.join(', ')}</span>. Download the
                  template to see the expected format.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-control border border-line bg-surface px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums text-accent">{preview.validCount}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted">Valid rows</p>
                </div>
                <div className="rounded-control border border-line bg-surface px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums text-danger">{preview.invalidCount}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted">Invalid rows</p>
                </div>
                <div className="rounded-control border border-line bg-surface px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums text-warn">{preview.duplicateCount}</p>
                  <p className="text-[11px] uppercase tracking-wide text-muted">Duplicates in file</p>
                </div>
              </div>
            )}

            {preview.invalidCount > 0 ? (
              <CheckboxField
                label={`Skip the ${preview.invalidCount} invalid row${preview.invalidCount === 1 ? '' : 's'} and import the rest`}
                description="Nothing is written until you press Import. Invalid rows are listed below and never skipped silently."
                checked={skippingInvalid}
                onChange={setSkippingInvalid}
              />
            ) : null}

            <SelectField
              label="If a player ID already exists in this event"
              value={duplicateMode}
              onChange={(event) => setDuplicateMode(event.target.value as 'fail' | 'skip-duplicates')}
              hint="Existing players are matched by player_id, case-insensitively."
            >
              <option value="fail">Stop and report (safe default)</option>
              <option value="skip-duplicates">Skip existing players</option>
            </SelectField>

            <div className="max-h-72 overflow-auto rounded-control border border-line">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface-muted">
                  <tr className="text-left uppercase tracking-wide text-muted">
                    <th className="px-2.5 py-2">Line</th>
                    <th className="px-2.5 py-2">Player ID</th>
                    <th className="px-2.5 py-2">Name</th>
                    <th className="px-2.5 py-2 text-right">Points</th>
                    <th className="px-2.5 py-2 text-right">Base ({currencyLabel})</th>
                    <th className="px-2.5 py-2">Problems</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {previewRows.map((row) => (
                    <tr key={row.line} className={row.errors.length > 0 ? 'bg-danger-soft/60' : undefined}>
                      <td className="px-2.5 py-1.5 tabular-nums text-muted">{row.line}</td>
                      <td className="px-2.5 py-1.5">{row.playerId ?? '—'}</td>
                      <td className="px-2.5 py-1.5 font-medium">{row.name || '—'}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{row.points ?? '—'}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{row.basePrice ?? '—'}</td>
                      <td className="px-2.5 py-1.5 text-danger">{row.errors.join(' ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > previewRows.length ? (
                <p className="border-t border-line bg-surface-muted px-2.5 py-1.5 text-[11px] text-muted">
                  Showing the first {previewRows.length} of {preview.rows.length} rows. Use the error
                  report for the full list.
                </p>
              ) : null}
            </div>

            {commitError ? (
              <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                {commitError}
              </p>
            ) : null}

            <div className="flex items-center gap-2 text-[11px] text-muted">
              {preview.canCommit ? (
                <>
                  <CheckCircle2 className="size-3.5 text-accent" aria-hidden />
                  Ready to import {preview.validCount} player{preview.validCount === 1 ? '' : 's'}.
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3.5 text-warn" aria-hidden />
                  Fix the file or adjust the options to continue.
                </>
              )}
              <span className="ml-auto inline-flex items-center gap-1">
                <Download className="size-3" aria-hidden />
                Template + error reports download as CSV
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
