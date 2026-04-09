import { useEffect, useState } from 'react'

interface ToastMessage {
  id: number
  text: string
  type?: 'success' | 'error' | 'default'
}

let addToast: (text: string, type?: ToastMessage['type']) => void = () => {}

export function showToast(text: string, type?: ToastMessage['type']) {
  addToast(text, type)
}

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    addToast = (text, type = 'default') => {
      const id = Date.now()
      setToasts(prev => [...prev, { id, text, type }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
    }
  }, [])

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-2 items-center pointer-events-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {toasts.map(t => (
        <div key={t.id} className={`
          px-4 py-2.5 rounded-full text-sm font-medium text-white shadow-lg
          animate-in fade-in slide-in-from-bottom-2 duration-200
          ${t.type === 'success' ? 'bg-emerald-800' : t.type === 'error' ? 'bg-red-700' : 'bg-slate-800'}
        `}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
