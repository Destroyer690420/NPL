import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AdminAuthProvider, isUsingDefaultAdminCredentials } from '@/auth/AdminAuthProvider'
import { AdminLoginPage } from '@/features/auth/AdminLoginPage'
import { CallError } from '@/services/callables'
import { adminLogin } from '@/services/adminAuth'

/**
 * Admin login wiring: credentials are verified server-side by the `adminLogin`
 * callable (mocked here), failures show generic copy, and the default-credential
 * warning flag is persisted after a successful login.
 */

vi.mock('@/lib/firebase', () => ({
  requireFirebase: () => ({ app: {}, auth: {}, db: {}, functions: {} }),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback(null)
    return () => undefined
  },
  signInWithCustomToken: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/services/adminAuth', () => ({ adminLogin: vi.fn() }))

const loginMock = vi.mocked(adminLogin)

function renderLogin() {
  return render(
    <AdminAuthProvider>
      <MemoryRouter initialEntries={['/admin/login']}>
        <Routes>
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin" element={<div>ADMIN HOME</div>} />
        </Routes>
      </MemoryRouter>
    </AdminAuthProvider>,
  )
}

async function submitCredentials(id: string, password: string): Promise<void> {
  await userEvent.type(screen.getByLabelText('Admin ID'), id)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('AdminLoginPage', () => {
  beforeEach(() => {
    loginMock.mockReset()
    window.localStorage.clear()
  })

  it('validates empty fields without calling the server', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Enter the admin ID.')).toBeInTheDocument()
    expect(screen.getByText('Enter the password.')).toBeInTheDocument()
    expect(loginMock).not.toHaveBeenCalled()
  })

  it('shows a generic error for a wrong ID/password and clears the password', async () => {
    loginMock.mockRejectedValue(
      new CallError({
        code: 'invalid-admin-login',
        message: 'Admin ID or password is incorrect.',
        retryable: true,
      }),
    )
    renderLogin()
    await submitCredentials('admin', 'wrong')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i))
    expect(loginMock).toHaveBeenCalledWith('admin', 'wrong')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('surfaces a rate-limit cooldown', async () => {
    loginMock.mockRejectedValue(
      new CallError({
        code: 'rate-limited',
        message: 'Too many attempts. Please wait and try again.',
        retryAfterSeconds: 42,
        retryable: true,
      }),
    )
    renderLogin()
    await submitCredentials('admin', 'nope')

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i))
  })

  it('enters the console after a successful login and remembers default credentials', async () => {
    loginMock.mockResolvedValue({ usingDefaultCredentials: true })
    renderLogin()
    await submitCredentials('admin', 'admin')

    await waitFor(() => expect(screen.getByText('ADMIN HOME')).toBeInTheDocument())
    expect(isUsingDefaultAdminCredentials()).toBe(true)
  })

  it('does not flag default credentials when they were changed server-side', async () => {
    loginMock.mockResolvedValue({ usingDefaultCredentials: false })
    renderLogin()
    await submitCredentials('organizer', 'long-secret')

    await waitFor(() => expect(screen.getByText('ADMIN HOME')).toBeInTheDocument())
    expect(isUsingDefaultAdminCredentials()).toBe(false)
  })
})
