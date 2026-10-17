import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { normalizeName } from '@shared/text'

export interface ComboboxItem {
  id: string
  label: string
  /** Extra searchable text (player id, team name, …). */
  keywords?: string
  sublabel?: ReactNode
  disabled?: boolean
  /** Shown next to the label for disabled entries, e.g. "Sold". */
  disabledReason?: string
}

export interface ComboboxProps {
  items: ComboboxItem[]
  value: string | null
  onChange: (id: string | null) => void
  placeholder?: string
  emptyMessage?: string
  disabled?: boolean
  id?: string
  ariaLabel?: string
  /** Custom option content; defaults to label + sublabel. */
  renderOption?: (item: ComboboxItem, selected: boolean) => ReactNode
}

/**
 * Searchable single-select combobox with full keyboard support.
 * Disabled items are visible but never selectable (sold players etc.).
 */
export function Combobox({
  items,
  value,
  onChange,
  placeholder = 'Search…',
  emptyMessage = 'No matches.',
  disabled = false,
  id,
  ariaLabel,
  renderOption,
}: ComboboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-listbox`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value])

  const filtered = useMemo(() => {
    const term = normalizeName(query ?? '')
    if (term === '') return items
    return items.filter((item) =>
      normalizeName(`${item.label} ${item.keywords ?? ''} ${item.disabledReason ?? ''}`).includes(term),
    )
  }, [items, query])

  // Keep the highlight on a selectable entry when the list changes.
  useEffect(() => {
    if (!open) return
    setHighlighted((current) => {
      const index = filtered.findIndex((item) => !item.disabled)
      if (index === -1) return 0
      if (current < filtered.length && !filtered[current]?.disabled) return current
      return index
    })
  }, [open, filtered])

  useEffect(() => {
    if (!open) return
    const element = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]')
    // jsdom (and some older engines) do not implement scrollIntoView.
    if (typeof element?.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlighted])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const displayValue = open ? (query ?? '') : (selected?.label ?? '')

  function moveHighlight(direction: 1 | -1): void {
    if (filtered.length === 0) return
    let index = highlighted
    for (let step = 0; step < filtered.length; step += 1) {
      index = (index + direction + filtered.length) % filtered.length
      if (!filtered[index]?.disabled) {
        setHighlighted(index)
        return
      }
    }
  }

  function select(item: ComboboxItem): void {
    if (item.disabled) return
    onChange(item.id)
    setOpen(false)
    setQuery(null)
    inputRef.current?.blur()
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
          value={displayValue}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) setOpen(true)
              else moveHighlight(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (open) moveHighlight(-1)
            } else if (event.key === 'Enter') {
              if (open) {
                event.preventDefault()
                const item = filtered[highlighted]
                if (item) select(item)
              }
            } else if (event.key === 'Escape') {
              if (open) {
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
                setQuery(null)
              }
            }
          }}
          className={cn(
            'h-10 w-full rounded-control border border-line-strong bg-surface pl-9 pr-9 text-sm text-ink',
            'placeholder:text-muted/70 focus:border-accent disabled:cursor-not-allowed disabled:bg-surface-muted',
          )}
        />
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-card border border-line bg-surface py-1 shadow-card"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">{emptyMessage}</li>
          ) : (
            filtered.map((item, index) => {
              const isSelected = item.id === value
              const isHighlighted = index === highlighted
              return (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={item.disabled || undefined}
                  data-highlighted={isHighlighted}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    select(item)
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm',
                    item.disabled && 'cursor-not-allowed opacity-55',
                    isHighlighted && !item.disabled && 'bg-accent-soft',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {renderOption ? (
                      renderOption(item, isSelected)
                    ) : (
                      <>
                        <span className="block truncate font-medium text-ink">{item.label}</span>
                        {item.sublabel ? (
                          <span className="block truncate text-xs text-muted">{item.sublabel}</span>
                        ) : null}
                      </>
                    )}
                  </div>
                  {item.disabled && item.disabledReason ? (
                    <span className="shrink-0 text-[11px] font-medium text-muted">
                      {item.disabledReason}
                    </span>
                  ) : isSelected ? (
                    <Check className="size-4 shrink-0 text-accent" aria-hidden />
                  ) : null}
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
