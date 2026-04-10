import { useEffect, useRef, useState } from 'react'

export interface ExportMenuProps {
  label?: string
  onCSV: () => void
  onXLSX: () => void
  onPDF: () => void
  onPPTX: () => void
}

const OPTIONS = [
  {
    key: 'csv',
    label: 'CSV',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M5 5h4M5 7.5h4M5 10h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'xlsx',
    label: 'Excel',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    key: 'pdf',
    label: 'PDF',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <path d="M5 5h2.5a1.5 1.5 0 010 3H5V5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    key: 'pptx',
    label: 'PowerPoint',
    icon: (
      <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="3" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
        <circle cx="5" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.1"/>
        <path d="M7 5h4M7 7h4M7 9h2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
      </svg>
    ),
  },
] as const

type OptionKey = typeof OPTIONS[number]['key']

export default function ExportMenu({ label = 'Export', onCSV, onXLSX, onPDF, onPPTX }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function handleOption(key: OptionKey) {
    setOpen(false)
    if (key === 'csv') onCSV()
    else if (key === 'xlsx') onXLSX()
    else if (key === 'pdf') onPDF()
    else if (key === 'pptx') onPPTX()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:bg-slate-100 min-h-[44px] transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="hidden sm:inline">{label}</span>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="ml-0.5 opacity-60">
          <path d="M1.5 3l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[160px]">
          {OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => handleOption(opt.key)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <span className="text-slate-400">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
