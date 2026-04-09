import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import { uid, downloadJSON, pickFile, readFileText } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import { defaultViewRange } from '../components/timelines/utils/dateLayout'
import type { Timeline, Timescale } from '../types'

const TIMESCALE_LABELS: Record<Timescale, string> = {
  days: 'Days', weeks: 'Weeks', months: 'Months', quarters: 'Quarters', years: 'Years',
}

export default function TimelinesPage() {
  const timelines = useAppStore(s => s.timelines)
  const addTimeline = useAppStore(s => s.addTimeline)
  const deleteTimeline = useAppStore(s => s.deleteTimeline)
  const navigate = useNavigate()

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newScale, setNewScale] = useState<Timescale>('months')

  const handleCreate = () => {
    if (!newName.trim()) return
    const range = defaultViewRange(newScale)
    const t: Timeline = {
      id: uid(),
      name: newName.trim(),
      createdAt: Date.now(),
      timescale: newScale,
      subTimescale: null,
      startDate: range.startDate,
      endDate: range.endDate,
      swimLanes: [{ id: uid(), label: 'Lane 1', color: '#6366f1' }],
      items: [],
      milestones: [],
    }
    addTimeline(t)
    showToast(`${t.name} created`, 'success')
    setShowNew(false)
    setNewName('')
    navigate(`/timelines/${t.id}`)
  }

  const handleExport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const t = timelines.find(x => x.id === id)
    if (!t) return
    downloadJSON(t, `timeline-${t.name.replace(/\s+/g, '-').toLowerCase()}.json`)
    showToast(`"${t.name}" exported`, 'success')
  }

  const handleExportAll = () => {
    downloadJSON(timelines, 'timelines.json')
    showToast('All timelines exported', 'success')
  }

  const handleImport = async () => {
    const file = await pickFile('.json')
    if (!file) return
    try {
      const data = JSON.parse(await readFileText(file))
      const arr = Array.isArray(data) ? data : [data]
      let added = 0
      for (const t of arr) {
        if (typeof t !== 'object' || !t?.name) continue
        addTimeline({ ...t, id: uid(), createdAt: Date.now() })
        added++
      }
      showToast(`${added} timeline${added !== 1 ? 's' : ''} imported`, 'success')
    } catch {
      showToast('Invalid JSON file')
    }
  }

  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    if (!confirm(`Delete "${name}"?`)) return
    deleteTimeline(id)
    showToast(`${name} deleted`)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Timelines</h1>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold px-3 py-2 rounded-xl min-h-[40px] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          New Timeline
        </button>
        {timelines.length > 0 && (
          <button onClick={handleExportAll}
            className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm font-medium px-3 py-2 rounded-xl min-h-[40px] hover:bg-slate-50 transition-colors">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="hidden sm:inline">Export all</span>
          </button>
        )}
        <button onClick={handleImport}
          className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-sm font-medium px-3 py-2 rounded-xl min-h-[40px] hover:bg-slate-50 transition-colors">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 5L2.5 9.5M7 5l4.5 4.5M7 5v8M1 1h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="hidden sm:inline">Import</span>
        </button>
      </div>

      {/* New timeline modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-slate-900">New Timeline</h2>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</label>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder="Q3 Roadmap"
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Timescale</label>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(TIMESCALE_LABELS) as Timescale[]).map(s => (
                  <button key={s} type="button"
                    onClick={() => setNewScale(s)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      newScale === s
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                    }`}>
                    {TIMESCALE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setShowNew(false); setNewName('') }}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 min-h-[48px] transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 min-h-[48px] transition-colors disabled:opacity-50">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4">
        {timelines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-20">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="2" y="8" width="24" height="4" rx="2" fill="#cbd5e1"/>
                <rect x="2" y="14" width="16" height="4" rx="2" fill="#e2e8f0"/>
                <rect x="2" y="20" width="20" height="4" rx="2" fill="#e2e8f0"/>
                <circle cx="22" cy="6" r="3" fill="#6366f1"/>
              </svg>
            </div>
            <div>
              <p className="text-slate-800 font-semibold text-base">No timelines yet</p>
              <p className="text-slate-400 text-sm mt-1">Create a timeline to plan projects visually</p>
            </div>
            <button
              onClick={() => setShowNew(true)}
              className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold px-5 py-3 rounded-xl min-h-[48px] transition-colors">
              Create your first timeline
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-w-2xl">
            {timelines
              .slice()
              .sort((a, b) => b.createdAt - a.createdAt)
              .map(t => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/timelines/${t.id}`)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 px-5 py-4 flex items-center gap-4 hover:border-blue-300 hover:shadow-sm transition-all group"
                >
                  {/* Color strip */}
                  <div className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: t.swimLanes[0]?.color ?? '#6366f1' }} />

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{t.name}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>{TIMESCALE_LABELS[t.timescale]}</span>
                      <span>·</span>
                      <span>{t.items.length} item{t.items.length !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{t.milestones.length} milestone{t.milestones.length !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{t.swimLanes.length} lane{t.swimLanes.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={e => handleExport(e, t.id)}
                      className="lg:opacity-0 lg:group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-all"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    <button
                      onClick={e => handleDelete(e, t.id, t.name)}
                      className="lg:opacity-0 lg:group-hover:opacity-100 p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-all"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M1 3h12M5 3V2h4v1M3 3l1 9h6l1-9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-slate-300 group-hover:text-slate-400 transition-colors">
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
