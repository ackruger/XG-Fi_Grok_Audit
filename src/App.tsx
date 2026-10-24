import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { FacilityProvider, useFacility } from './context/FacilityContext'
import AppLayout from './components/AppLayout'
import AuthPage from './pages/AuthPage'
import FindPage from './pages/FindPage'
import DashboardPage from './pages/DashboardPage'
import AssetsPage from './pages/AssetsPage'
import AssetDetailPage from './pages/AssetDetailPage'
import IssuesPage from './pages/IssuesPage'
import IssueDetailPage from './pages/IssueDetailPage'
import AIChatPage from './pages/AIChatPage'
import SettingsPage from './pages/SettingsPage'
import QRAdminPage from './pages/QRAdminPage'
import UserManualPage from './pages/UserManualPage'
import FacilitySetupPage from './pages/FacilitySetupPage'
import FacilitiesPage from './pages/FacilitiesPage'
import TagsPage from './pages/TagsPage'
import TeamPage from './pages/TeamPage'
import AssetTypesPage from './pages/AssetTypesPage'
import QRResolverPage from './pages/QRResolverPage'
import OrganizationsPage from './pages/OrganizationsPage'
import CasesPage from './pages/CasesPage'
import AssetImportPage from './pages/AssetImportPage'
import FacilityDocumentsPage from './pages/FacilityDocumentsPage'
import ChecklistTemplatesPage from './pages/ChecklistTemplatesPage'
import PlanAuthoringPage from './pages/PlanAuthoringPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ErrorBoundary from './components/ErrorBoundary'

function isDeepLinkPath(pathname: string) {
  return pathname.startsWith('/q/') || pathname.startsWith('/scan/')
}

function AppRoutes() {
  const { session, loading: authLoading, passwordRecovery } = useAuth()
  const { currentFacility, currentOrganization, loading: facLoading } = useFacility()
  const location = useLocation()

  if (authLoading || (session && facLoading)) {
    return (
      <div className="h-full flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-primary-200 border-t-primary-700 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-neutral-500 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    const returnTo = isDeepLinkPath(location.pathname)
      ? location.pathname
      : undefined
    return <AuthPage returnTo={returnTo} />
  }

  if (passwordRecovery) return <ResetPasswordPage />

  if (isDeepLinkPath(location.pathname)) {
    return (
      <Routes>
        <Route path="/q/:token" element={<QRResolverPage />} />
        <Route path="/scan/:token" element={<QRResolverPage />} />
      </Routes>
    )
  }

  if (!currentOrganization || !currentFacility) return <FacilitySetupPage />

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/scan" element={<FindPage />} />
        <Route path="/find" element={<FindPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/facilities" element={<FacilitiesPage />} />
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="/assets/:id" element={<AssetDetailPage />} />
        <Route path="/cases" element={<CasesPage />} />
        <Route path="/cases/:id" element={<IssueDetailPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/issues/:id" element={<IssueDetailPage />} />
        <Route path="/tags" element={<TagsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/ai-chat" element={<AIChatPage />} />
        <Route path="/qr-admin" element={<QRAdminPage />} />
        <Route path="/user-manual" element={<UserManualPage />} />
        <Route path="/asset-types" element={<AssetTypesPage />} />
        <Route path="/checklist-templates" element={<ChecklistTemplatesPage />} />
        <Route path="/plans" element={<PlanAuthoringPage />} />
        <Route path="/asset-import" element={<AssetImportPage />} />
        <Route path="/documents" element={<FacilityDocumentsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <FacilityProvider>
            <AppRoutes />
          </FacilityProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
