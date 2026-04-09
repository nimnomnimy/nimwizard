import { useState, useEffect } from 'react'
import type { SubTask, Task } from '../../types'
import { uid } from '../../lib/utils'

interface Props {
  open: boolean
  subTask: SubTask | null       // null = new
  parentTask: Task | null       // the parent task
  allTasks?: Task[]             // for predecessor linking
  onSave: (sub: SubTask) => void
  onDelete?: (id: string) => void
  onClose: () => void
}

const PRIORITIES = [
  { value: 'low',    label: 'Low',    color: 'text-emerald-600 bg-emerald-50' },
  { value: 'medium', label: 'Medium', color: 'text-amber-600 bg-amber-50' },
  { value: 'high',   label: 'High',   color: 'text-red-600 bg-red-50' },
]

export default function SubTaskDrawer({ open, subTask, parentTask, allTasks = [], onSave, onDelete, onClose }: Props) {
  const [text,      setText]      = useState('')
  const [priority,  setPriority]  = useState<'low' | 'medium' | 'high'>('medium')
  const [startDate, setStartDate] = useState('')
  const [due,       setDue]       = useState('')
  const [notes,     setNotes]     = useState('')
  const [progress,  setProgress]  = useState(0)
  const [done,      setDone]      = useState(false)
  const [predIds,   setPredIds]   = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setText(subTask?.text ?? '')
    setPriority(subTask?.priority ?? 'medium')
    setStartDate(subTask?.startDate ?? '')
    setDue(subTask?.due ?? '')
    setNotes(subTask?.notes ?? '')
    setProgress(subTask?.progress ?? 0)
    setDone(subTask?.done ?? false)
    setPredIds(subTask?.predecessorIds ?? [])
  }, [open, subTask])

  function handleSave() {
    if (!text.trim()) return
    onSave({
      id: subTask?.id ?? uid(),
      text: text.trim(),
      priority,
      startDate: startDate || undefined,
      due: due || undefined,
      notes: notes.trim() || undefined,
      progress: progress > 0 ? progress : undefined,
      done,
      predecessorIds: predIds.length > 0 ? predIds : undefined,
    })
  }

  // All subtasks from all tasks for predecessor selection (excluding this sub-task)
  const allSubTasks = allTasks.flatMap(t =>
    (t.subTasks ?? []).map(s => ({ ...s, parentText: t.text }))
  ).filter(s => s.id !== subTask?.id)

  const togglePred = (id: string) => {
    setPredIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const isNew = !subTask

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={`
        fixed z-50 bg-white shadow-2xl flex flex-col
        transition-transform duration-300 ease-in-out
        inset-x-0 bottom-0 rounded-t-2xl max-h-[90dvh]
        lg:inset-y-0 lg:right-0 lg:left-auto lg:w-88 lg:rounded-none lg:max-h-full
        ${open ? 'translate-y-0 lg:translate-x-0' : 'translate-y-full lg:translate-x-full'}
      `} style={{ '--tw-w': '22rem' } as React.CSSProperties}>

        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">{isNew ? 'New Sub-task' : 'Edit Sub-task'}</h2>
            {parentTask && <p className="text-xs text-slate-400 mt-0.5">Under: {parentTask.text}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-4">

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sub-task <span className="text-red-400">*</span></label>
            <input autoFocus type="text" value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
              placeholder="What needs to be done?"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Priority</label>
            <div className="flex gap-2">
              {PRIORITIES.map(p => (
                <button key={p.value} type="button" onClick={() => setPriority(p.value as typeof priority)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all min-h-[44px] ${
                    priority === p.value ? `${p.color} border-current` : 'border-slate-200 text-slate-400 bg-white'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white" />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Due Date</label>
              <input type="date" value={due} onChange={e => setDue(e.target.value)}
                min={startDate}
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Progress — {progress}%</label>
            <input type="range" min={0} max={100} value={progress}
              onChange={e => setProgress(Number(e.target.value))}
              className="w-full accent-blue-500" />
            <div className="flex gap-1.5 flex-wrap">
              {[0, 25, 50, 75, 100].map(v => (
                <button key={v} type="button" onClick={() => setProgress(v)}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                    progress === v ? 'bg-blue-500 text-white border-blue-500' : 'border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}>
                  {v}%
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <span className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'}`}>
              {done && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5l2.5 2.5 4.5-4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="sr-only" />
            <span className="text-sm font-medium text-slate-700">Mark as done</span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Additional details…"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          {/* Predecessors */}
          {allSubTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Predecessors</label>
              <p className="text-[11px] text-slate-400">Sub-tasks that must complete before this one</p>
              <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border border-slate-100 rounded-xl">
                {allSubTasks.map(s => (
                  <label key={s.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 cursor-pointer min-h-[40px]">
                    <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${predIds.includes(s.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                      {predIds.includes(s.id) && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-3.5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>}
                    </span>
                    <input type="checkbox" checked={predIds.includes(s.id)} onChange={() => togglePred(s.id)} className="sr-only" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{s.text}</p>
                      <p className="text-[10px] text-slate-400 truncate">{s.parentText}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="h-2" />
        </div>

        <div className="flex gap-3 px-4 py-4 border-t border-slate-100 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {!isNew && onDelete && (
            <button type="button" onClick={() => subTask && onDelete(subTask.id)}
              className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 min-h-[48px] transition-colors">
              Delete
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={!text.trim()}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 min-h-[48px] transition-colors disabled:opacity-50">
            {isNew ? 'Add Sub-task' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}
