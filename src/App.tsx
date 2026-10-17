import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AdminAuthProvider } from '@/auth/AdminAuthProvider'
import { TeamAuthProvider, useTeamAuth } from '@/auth/TeamAuthProvider'
import { AdminEventProvider } from '@/app/AdminEventProvider'
import { AdminShell, RequireAdmin } from '@/app/AdminShell'
import { LoadingBlock } from '@/components/ui/Feedback'
import { AdminLoginPage } from '@/features/auth/AdminLoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { PlayersPage } from '@/features/players/PlayersPage'
import { RecordPurchasePage } from '@/features/purchases/RecordPurchasePage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TeamDetailPage } from '@/features/teams/TeamDetailPage'
import { TeamsPage } from '@/features/teams/TeamsPage'
import { TransactionsPage } from '@/features/transactions/TransactionsPage'
import { TeamLoginPage } from '@/features/teamPanel/TeamLoginPage'
import { TeamPanelPage } from '@/features/teamPanel/TeamPanelPage'

/** `/team` either shows the PIN login or the team's private panel. */
function TeamRoute() {
  const auth = useTeamAuth()
  if (auth.status === 'loading') return <LoadingBlock label="Restoring your session…" />
  if (auth.status === 'signedOut') return <TeamLoginPage />
  return <TeamPanelPage />
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />

        <Route
          path="/admin/login"
          element={
            <AdminAuthProvider>
              <AdminLoginPage />
            </AdminAuthProvider>
          }
        />

        <Route
          path="/admin"
          element={
            <AdminAuthProvider>
              <RequireAdmin>
                <AdminEventProvider>
                  <AdminShell />
                </AdminEventProvider>
              </RequireAdmin>
            </AdminAuthProvider>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="purchases/new" element={<RecordPurchasePage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="teams/:teamId" element={<TeamDetailPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>

        <Route
          path="/team"
          element={
            <TeamAuthProvider>
              <TeamRoute />
            </TeamAuthProvider>
          }
        />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
