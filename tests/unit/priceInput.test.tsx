import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { RecordPurchasePage } from '@/features/purchases/RecordPurchasePage'
import { ToastProvider } from '@/components/ui/Toast'
import { makeEvent, makePlayer, makeTeam } from '@shared/fixtures'

vi.mock('@/services/admin', () => ({
  clearSpotlightPlayer: vi.fn(),
  markPlayerUnsold: vi.fn(),
  recordPurchase: vi.fn(),
  setSpotlightPlayer: vi.fn().mockResolvedValue({ ok: true }),
  startRound1: vi.fn(),
  endRound1: vi.fn(),
  resumeRound1: vi.fn(),
  startRound2: vi.fn(),
  endRound2: vi.fn(),
  resumeRound2: vi.fn(),
  setPresenterView: vi.fn(),
  sendPresenterCommand: vi.fn(),
}))

vi.mock('@/app/AdminEventProvider', () => ({
  useAdminEvent: () => ({
    event: makeEvent({ status: 'active' }),
    eventId: 'default',
    loading: false,
    error: null,
    fromCache: false,
  }),
}))

vi.mock('@/data/hooks', () => ({
  usePlayers: () => ({
    data: [makePlayer('p1', { name: 'Virat Kohli', basePrice: 20_000_000, points: 9.7 })],
    loading: false,
    error: null,
    fromCache: false,
  }),
  useTeams: () => ({
    data: [makeTeam('t1', { name: 'TEAM 01', startingPurse: 1_250_000_000 })],
    loading: false,
    error: null,
    fromCache: false,
  }),
  usePurchases: () => ({
    data: [],
    loading: false,
    error: null,
    fromCache: false,
  }),
}))

function renderRecordPurchase() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/admin/record?playerId=p1']}>
        <Routes>
          <Route element={<Outlet context={{ eventId: 'default', admin: null }} />}>
            <Route path="/admin/record" element={<RecordPurchasePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('Final sale price input in RecordPurchasePage', () => {
  it('preserves remaining zeros when replacing the leading digit instead of wiping to 0', () => {
    renderRecordPurchase()
    const input = screen.getByLabelText(/Final sale price/i) as HTMLInputElement
    expect(input.value).toBe('2,00,00,000')

    input.focus()
    input.setSelectionRange(1, 1)

    // Delete leading "2" -> ",00,00,000"
    fireEvent.change(input, {
      target: { value: ',00,00,000', selectionStart: 0 },
    })
    expect(input.value).toBe('00,00,000')
    expect(input.selectionStart).toBe(0)

    // Type "4" at front -> "4,00,00,000" and caret stays right after "4"
    fireEvent.change(input, {
      target: { value: '400,00,000', selectionStart: 1 },
    })
    expect(input.value).toBe('4,00,00,000')
    expect(input.selectionStart).toBe(1)
  })

  it('keeps caret position in the middle when typing digits instead of jumping to end', () => {
    renderRecordPurchase()
    const input = screen.getByLabelText(/Final sale price/i) as HTMLInputElement
    input.focus()

    // Start from 40,00,000
    fireEvent.change(input, {
      target: { value: '4000000', selectionStart: 7 },
    })
    expect(input.value).toBe('40,00,000')

    // Insert "5" after "4" -> "450,00,000" -> formatted "4,50,00,000" with caret after "4,5" (index 3)
    fireEvent.change(input, {
      target: { value: '450,00,000', selectionStart: 2 },
    })
    expect(input.value).toBe('4,50,00,000')
    expect(input.selectionStart).toBe(3)
  })

  it('normalizes leading zeros on blur', () => {
    renderRecordPurchase()
    const input = screen.getByLabelText(/Final sale price/i) as HTMLInputElement
    input.focus()

    fireEvent.change(input, {
      target: { value: '04,00,000', selectionStart: 2 },
    })
    expect(input.value).toBe('04,00,000')

    fireEvent.blur(input)
    expect(input.value).toBe('4,00,000')
  })
})
