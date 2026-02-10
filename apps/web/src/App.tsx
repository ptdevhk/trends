import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from '@/components/Header'
import { ResumesPage } from '@/pages/ResumesPage'
import { DebugPage } from '@/pages/DebugPage'
import DebugJDs from '@/pages/DebugJDs'
import DebugAI from '@/pages/DebugAI'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-6">
          <Routes>
            <Route path="/" element={<Navigate to="/resumes" replace />} />
            <Route path="/resumes" element={<ResumesPage />} />
            <Route path="/debug/jds" element={<DebugJDs />} />
            <Route path="/debug/ai" element={<DebugAI />} />
            <Route path="/debug/*" element={<DebugPage />} />
            <Route path="*" element={<Navigate to="/resumes" replace />} />
          </Routes>
        </main>

        <footer className="border-t py-6 mt-8" />
      </div>
    </BrowserRouter>
  )
}

export default App
