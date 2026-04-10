import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import TimelineEditor from '../components/timelines/TimelineEditor'
import type { Timeline } from '../types'
import {
  exportTimelineCSV,
  exportTimelineXLSX,
  exportTimelinePDF,
  exportTimelinePPTX,
} from '../lib/exportUtils'
import { importTimelineFromCSV, importTimelineFromXLSX } from '../lib/importTimeline'
import { pickFile, readFileText } from '../lib/utils'
import { showToast } from '../components/ui/Toast'

type ExportMode = 'gantt' | 'table' | 'both'

// Two-step export popover: pick mode then format
function TimelineExportMenu({ timeline }: { timeline: Timeline }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'mode' | 'format'>('mode')
  const [mode, setMode] = useState<ExportMode>('both')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setStep('mode')
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function close() { setOpen(false); setStep('mode') }

  function pickMode(m: ExportMode) { setMode(m); setStep('format') }

  function doExport(fmt: 'csv' | 'xlsx' | 'pdf' | 'pptx') {
    close()
    if (fmt === 'csv') exportTimelineCSV(timeline, mode)
    else if (fmt === 'xlsx') exportTimelineXLSX(timeline, mode)
    else if (fmt === 'pdf') exportTimelinePDF(timeline, mode)
    else exportTimelinePPTX(timeline, mode)
    showToast(`Exported as ${fmt.toUpperCase()}`, 'success')
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setStep('mode') }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:bg-slate-100 transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="hidden sm:inline">Export</span>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="ml-0.5 opacity-60">
          <path d="M1.5 3l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[180px]">
          {step === 'mode' ? (
            <>
              <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                What to export
              </div>
              {([['gantt', 'Gantt view'], ['table', 'Table only'], ['both', 'Both']] as [ExportMode, string][]).map(([m, lbl]) => (
                <button key={m} onClick={() => pickMode(m)}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  {lbl}
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="opacity-40">
                    <path d="M3 1.5l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-100 flex items-center gap-2">
                <button onClick={() => setStep('mode')} className="hover:text-slate-600 transition-colors">
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                    <path d="M6 1.5L3 4.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
                Format
              </div>
              {([['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF'], ['pptx', 'PowerPoint']] as ['csv'|'xlsx'|'pdf'|'pptx', string][]).map(([fmt, lbl]) => (
                <button key={fmt} onClick={() => doExport(fmt)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  {lbl}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TimelineEditorPage() {
  const { id } = useParams<{ id: string }>()
  const timelines = useAppStore(s => s.timelines)
  const updateTimeline = useAppStore(s => s.updateTimeline)
  const navigate = useNavigate()

  const timeline = timelines.find(t => t.id === id)

  if (!timeline) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-4 bg-slate-50">
        <p className="text-slate-500 text-sm">Timeline not found</p>
        <button
          onClick={() => navigate('/timelines')}
          className="text-blue-500 text-sm font-semibold hover:underline">
          Back to Timelines
        </button>
      </div>
    )
  }

  const handleChange = (updated: Timeline) => {
    updateTimeline(updated)
  }

  const handleImport = async () => {
    const file = await pickFile('.csv,.xlsx')
    if (!file) return
    try {
      let result: { items: typeof timeline.items; milestones: typeof timeline.milestones }
      if (file.name.endsWith('.xlsx')) {
        const buffer = await file.arrayBuffer()
        result = await importTimelineFromXLSX(buffer, timeline.swimLanes)
      } else {
        const text = await readFileText(file)
        result = importTimelineFromCSV(text, timeline.swimLanes)
      }
      handleChange({
        ...timeline,
        items: [...timeline.items, ...result.items],
        milestones: [...timeline.milestones, ...result.milestones],
      })
      showToast(`Imported ${result.items.length} item(s) and ${result.milestones.length} milestone(s)`, 'success')
    } catch (err) {
      showToast('Import failed — check file format')
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 flex-shrink-0 bg-white">
        <button
          onClick={() => navigate('/timelines')}
          className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <input
          type="text"
          value={timeline.name}
          onChange={e => handleChange({ ...timeline, name: e.target.value })}
          className="flex-1 text-base font-bold text-slate-900 bg-transparent focus:outline-none focus:bg-slate-50 rounded-lg px-2 py-1 min-w-0"
        />
        {/* Date range */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
          <input type="date" value={timeline.startDate}
            onChange={e => handleChange({ ...timeline, startDate: e.target.value })}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
          <span>→</span>
          <input type="date" value={timeline.endDate}
            onChange={e => handleChange({ ...timeline, endDate: e.target.value })}
            className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {/* Import button */}
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:bg-slate-100 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M7 5L2.5 9.5M7 5l4.5 4.5M7 5v8M1 1h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="hidden sm:inline">Import</span>
        </button>

        {/* Export menu */}
        <TimelineExportMenu timeline={timeline} />
      </div>

      {/* Mobile date range */}
      <div className="sm:hidden flex items-center gap-1.5 px-4 py-2 border-b border-slate-100 bg-white text-xs">
        <input type="date" value={timeline.startDate}
          onChange={e => handleChange({ ...timeline, startDate: e.target.value })}
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
        <span className="text-slate-400">→</span>
        <input type="date" value={timeline.endDate}
          onChange={e => handleChange({ ...timeline, endDate: e.target.value })}
          className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400" />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <TimelineEditor timeline={timeline} onChange={handleChange} />
      </div>
    </div>
  )
}
