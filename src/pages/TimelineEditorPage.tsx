import { useParams, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import TimelineEditor from '../components/timelines/TimelineEditor'
import type { Timeline } from '../types'

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
