import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useAdminAuth, signInErrorMessage } from '@/auth/AdminAuthProvider'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { InputField } from '@/components/ui/Field'

export function AdminLoginPage() {
  const auth = useAdminAuth()
  const navigate = useNavigate()

  const [adminId, setAdminId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{ adminId?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  if (auth.status === 'signedIn') return <Navigate to="/admin" replace />

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setFormError(null)
    const errors: { adminId?: string; password?: string } = {}
    if (adminId.trim() === '') errors.adminId = 'Enter the admin ID.'
    if (password === '') errors.password = 'Enter the password.'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSigningIn(true)
    try {
      await auth.signIn(adminId, password)
      navigate('/admin', { replace: true })
    } catch (error) {
      setFormError(signInErrorMessage(error))
      setPassword('')
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-6 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1">
          <span className="size-1.5 rounded-full bg-accent shadow-[0_0_6px_rgba(230,0,110,0.8)]" />
          <p className="text-[11px] font-bold uppercase tracking-wider text-accent-light">
            Organizer Portal
          </p>
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-white">Admin sign in</h1>
        <p className="mt-1 text-sm text-ink-muted">Enter organizer credentials to manage the live auction.</p>
      </div>

      <Card className="border-line-strong bg-surface-elevated/90 p-2 shadow-2xl backdrop-blur-md">
        <CardBody>
          {auth.status === 'notAuthorized' ? (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300">
              <p className="font-semibold">This session does not have admin access.</p>
              <p className="mt-0.5 text-xs text-amber-200/80">
                Sign out and try again with the organizer credentials.
              </p>
              <button
                type="button"
                className="mt-1.5 text-xs font-medium underline underline-offset-2"
                onClick={() => void auth.signOut()}
              >
                Sign out
              </button>
            </div>
          ) : null}

          <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
            <InputField
              label="Admin ID"
              type="text"
              autoComplete="username"
              value={adminId}
              error={fieldErrors.adminId}
              onChange={(event) => setAdminId(event.target.value)}
              placeholder="admin"
            />
            <InputField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              error={fieldErrors.password}
              onChange={(event) => setPassword(event.target.value)}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="rounded-md p-1 text-muted hover:text-ink"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              }
            />

            {formError ? (
              <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            ) : null}

            <Button
              type="submit"
              block
              size="lg"
              loading={signingIn}
              icon={<LockKeyhole className="size-4" aria-hidden />}
            >
              Sign in
            </Button>
          </form>

          <div className="mt-4 text-right text-xs">
            <a href="/team" className="text-muted underline-offset-2 hover:text-ink hover:underline">
              Team login →
            </a>
          </div>
        </CardBody>
      </Card>
    </main>
  )
}
