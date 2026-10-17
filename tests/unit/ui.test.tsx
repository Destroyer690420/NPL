import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Combobox, type ComboboxItem } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { PlayerAvatar } from '@/components/ui/PlayerAvatar'
import { SetupScreen } from '@/app/SetupScreen'

// Deterministic regardless of the local .env.local (which may be configured).
vi.mock('@/lib/config', () => ({
  missingSupabaseKeys: () => ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
}))

const ITEMS: ComboboxItem[] = [
  { id: 'p1', label: 'Rohit', sublabel: '250 pts' },
  { id: 'p2', label: 'Ishan', sublabel: '180 pts', disabled: true, disabledReason: 'Sold' },
  { id: 'p3', label: 'Jasprit', sublabel: '180 pts' },
]

describe('Combobox', () => {
  it('selects items with the keyboard, skipping disabled entries', async () => {
    const onChange = vi.fn()
    render(<Combobox items={ITEMS} value={null} onChange={onChange} placeholder="Search players…" />)

    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    // First enabled entry is highlighted; one ArrowDown skips the disabled Ishan -> Jasprit.
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('p3')
  })

  it('never selects a disabled item on click', async () => {
    const onChange = vi.fn()
    render(<Combobox items={ITEMS} value={null} onChange={onChange} />)
    await userEvent.click(screen.getByRole('combobox'))
    const soldOption = screen.getByRole('option', { name: /Ishan/ })
    expect(soldOption).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(soldOption)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('filters by label and clears selection with Escape', async () => {
    const onChange = vi.fn()
    render(<Combobox items={ITEMS} value="p1" onChange={onChange} />)
    const input = screen.getByRole('combobox')
    expect(input).toHaveValue('Rohit')

    await userEvent.click(input)
    await userEvent.keyboard('jasp')
    expect(screen.getByRole('option', { name: /Jasprit/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Rohit/ })).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(input).toHaveValue('Rohit'))
  })
})

describe('Dialog', () => {
  it('traps focus, labels itself and closes on Escape', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Confirm purchase" footer={<button type="button">OK</button>}>
        <input aria-label="price" />
      </Dialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Confirm purchase' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when dismissible is false', async () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Save this PIN" dismissible={false}>
        <p>1234</p>
      </Dialog>,
    )
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /close dialog/i })).not.toBeInTheDocument()
  })
})

describe('SetupScreen', () => {
  it('lists every missing environment key instead of faking data', () => {
    render(<SetupScreen />)
    expect(screen.getByText(/Supabase is not configured yet/i)).toBeInTheDocument()
    expect(screen.getAllByText('VITE_SUPABASE_URL').length).toBeGreaterThan(0)
    expect(screen.getAllByText('VITE_SUPABASE_ANON_KEY').length).toBeGreaterThan(0)
  })
})

describe('PlayerAvatar', () => {
  it('renders initials badge when photoUrl is absent', () => {
    const { rerender } = render(<PlayerAvatar name="Rohit Sharma" />)
    expect(screen.getByText('RO')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    rerender(<PlayerAvatar name="Naman Dhir" />)
    expect(screen.getByText('NA')).toBeInTheDocument()
  })

  it('renders image when photoUrl is provided', () => {
    render(<PlayerAvatar name="Rohit Sharma" photoUrl="https://example.com/rohit.jpg" />)
    const img = screen.getByRole('img', { name: 'Rohit Sharma' })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/rohit.jpg')
    expect(screen.queryByText('RO')).not.toBeInTheDocument()
  })

  it('falls back cleanly to initials if image fails to load', () => {
    render(<PlayerAvatar name="Rohit Sharma" photoUrl="https://example.com/broken.jpg" />)
    const img = screen.getByRole('img', { name: 'Rohit Sharma' })
    fireEvent.error(img)
    expect(screen.getByText('RO')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

