import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Header } from '@/components/Header'
import { ResumesPage } from '@/pages/ResumesPage'
import { TrendsPage } from '@/pages/TrendsPage'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container py-6">
          <Routes>
            <Route path="/" element={<Navigate to="/resumes" replace />} />
            <Route path="/resumes" element={<ResumesPage />} />
            <Route path="/trends" element={<TrendsPage />} />
            <Route path="*" element={<Navigate to="/resumes" replace />} />
          </Routes>
        </main>

        <footer className="border-t py-6 mt-8" />
      </div>
    </BrowserRouter>
  )
}

export default App
