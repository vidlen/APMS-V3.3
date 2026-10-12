import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Admin from './pages/Admin'
import { Toaster } from '@/components/ui/sonner'
import { Analytics } from '@vercel/analytics/react'

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
      <Toaster />
      <Analytics />
    </>
  )
}
