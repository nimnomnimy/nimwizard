import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useAppStore } from './store/useAppStore'
import AppShell from './components/layout/AppShell'
import LoginPage from './pages/LoginPage'
import ContactsPage from './pages/ContactsPage'
import OrgChartPage from './pages/OrgChartPage'
import MeetingsPage from './pages/MeetingsPage'
import TasksPage from './pages/TasksPage'
import SetupPage from './pages/SetupPage'
import AdminPage from './pages/AdminPage'
import TimelinesPage from './pages/TimelinesPage'
import TimelineEditorPage from './pages/TimelineEditorPage'
import DiagramsPage from './pages/DiagramsPage'
import DealEnginePage from './pages/DealEnginePage'
import ProductsPage from './pages/ProductsPage'
import PricebookPage from './pages/PricebookPage'
import ContractManagerPage from './pages/ContractManagerPage'
import TimelineViewPage from './pages/TimelineViewPage'

function AppRoutes() {
  useAuth()
  const uid = useAppStore(s => s.uid)
  const loading = useAppStore(s => s.loading)

  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!uid) return <LoginPage />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/contacts" replace />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/org"      element={<OrgChartPage />} />
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/tasks"       element={<TasksPage />} />
        <Route path="/timelines"   element={<TimelinesPage />} />
        <Route path="/timelines/:id" element={<TimelineEditorPage />} />
        <Route path="/diagrams"    element={<DiagramsPage />} />
        <Route path="/deals"       element={<DealEnginePage />} />
        <Route path="/configs"     element={<ProductsPage />} />
        <Route path="/pricebooks"  element={<PricebookPage />} />
        <Route path="/contracts"   element={<ContractManagerPage />} />
        <Route path="/setup"       element={<SetupPage />} />
      </Route>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/view/:token" element={<TimelineViewPage />} />
      <Route path="*" element={<Navigate to="/contacts" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
