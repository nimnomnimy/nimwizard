import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast.tsx'
import UpdatePrompt from './components/ui/UpdatePrompt.tsx'
import InstallPrompt from './components/ui/InstallPrompt.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ToastProvider />
    <UpdatePrompt />
    <InstallPrompt />
  </StrictMode>,
)
