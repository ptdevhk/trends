import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Header } from '@/components/Header'
import { ResumesPage } from '@/pages/ResumesPage'
import { DebugPage } from '@/pages/DebugPage'
import DebugJDs from '@/pages/DebugJDs'
import DebugAI from '@/pages/DebugAI'
import DebugConfig from '@/pages/DebugConfig'
import SystemLayout from '@/layouts/SystemLayout'

function MainShell() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6">
        <Outlet />
      </main>
      <footer className="border-t py-6 mt-8" />
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Dedicated System Administration Shell */}
        <Route path="/system" element={<SystemLayout />}>
          <Route index element={<Navigate to="settings" replace />} />
          <Route path="settings" element={<DebugConfig />} />
          <Route path="jds" element={<DebugJDs />} />
          <Route path="ai-debugger" element={<DebugAI />} />
          <Route path="data/*" element={<DebugPage basePath="/system/data" />} />
        </Route>

        {/* Default App Shell */}
        <Route element={<MainShell />}>
          <Route path="/" element={<Navigate to="/resumes" replace />} />
          <Route path="/resumes" element={<ResumesPage />} />

          {/* Legacy Redirects */}
          <Route path="/config/jds" element={<Navigate to="/system/jds" replace />} />
          <Route path="/debug/jds" element={<Navigate to="/system/jds" replace />} />
          <Route path="/debug/config" element={<Navigate to="/system/settings" replace />} />
          <Route path="/debug/ai" element={<Navigate to="/system/ai-debugger" replace />} />
          <Route path="/debug/*" element={<Navigate to="/system/data" replace />} />

          <Route path="*" element={<Navigate to="/resumes" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
