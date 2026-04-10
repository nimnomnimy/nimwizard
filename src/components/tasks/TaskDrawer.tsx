import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { uid } from '../../lib/utils'
import { showToast } from '../ui/Toast'
import type { Task, TaskBucket } from '../../types'

interface Props {
  open: boolean
  bucketId: string
  task: Task | null
  onClose: () => void
}

const PRIORITIES = [
  { value: 'low',    label: 'Low',    color: 'text-emerald-600 bg-emerald-50' },
  { value: 'medium', label: 'Medium', color: 'text-amber-600 bg-amber-50' },
  { value: 'high',   label: 'High',   color: 'text-red-600 bg-red-50' },
]

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function TaskDrawer({ open, bucketId, task, onClose }: Props) {
  const taskBuckets           = useAppStore(s => s.taskBuckets)
  const timelines             = useAppStore(s => s.timelines)
  const saveTaskWithTimelineItem = useAppStore(s => s.saveTaskWithTimelineItem)
  const setTaskBuckets        = useAppStore(s => s.setTaskBuckets)

  const [text,         setText]        = useState('')
  const [notes,        setNotes]       = useState('')
  const [priority,     setPriority]    = useState<'low' | 'medium' | 'high'>('medium')
  const [startDate,    setStartDate]   = useState(todayStr())
  const [due,          setDue]         = useState('')
  const [progress,     setProgress]    = useState(0)
  const [targetBucket, setTargetBucket] = useState(bucketId)
  const [timelineId,   setTimelineId]  = useState<string>('')
  const [swimLaneId,   setSwimLaneId]  = useState<string>('')
  const titleRef = useRef<HTMLInputElement>(null)

  const selectedTimeline = useMemo(
    () => timelines.find(tl => tl.id === timelineId) ?? null,
    [timelines, timelineId],
  )

  // Reset swim lane when timeline changes
  useEffect(() => {
    if (selectedTimeline) {
      setSwimLaneId(prev => selectedTimeline.swimLanes.some(l => l.id === prev) ? prev : (selectedTimeline.swimLanes[0]?.id ?? ''))
    } else {
      setSwimLaneId('')
    }
  }, [timelineId])

  useEffect(() => {
    if (open) {
      setText(task?.text ?? '')
      setNotes(task?.notes ?? '')
      setPriority(task?.priority ?? 'medium')
      setStartDate(task?.startDate ?? todayStr())
      setDue(task?.due ?? '')
      setProgress(task?.progress ?? 0)
      setTargetBucket(bucketId)
      setTimelineId(task?.timelineId ?? '')
      setSwimLaneId(task?.swimLaneId ?? '')
      setTimeout(() => titleRef.current?.focus(), 100)
    }
  }, [open, task, bucketId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return

    const updated: Task = {
      id: task?.id ?? uid(),
      text: text.trim(),
      notes: notes.trim() || undefined,
      priority,
      startDate: startDate || undefined,
      due: due || undefined,
      progress: progress > 0 ? progress : undefined,
      createdAt: task?.createdAt ?? Date.now(),
      // Preserve fields not edited here
      subTasks: task?.subTasks,
      collapsed: task?.collapsed,
      predecessorIds: task?.predecessorIds,
      timelineId: timelineId || undefined,
      swimLaneId: swimLaneId || undefined,
    }

    // Auto-move to done bucket if progress = 100
    const effectiveBucket = progress >= 100
      ? (taskBuckets.find(b => b.id === 'done')?.id ?? targetBucket)
      : targetBucket

    // Use atomic action — handles bucket upsert + timeline bar create/update
    saveTaskWithTimelineItem(effectiveBucket, updated)

    // If bucket changed for an existing task, also remove from old bucket
    if (task && effectiveBucket !== bucketId) {
      const newBuckets = taskBuckets.map((b: TaskBucket) =>
        b.id === bucketId ? { ...b, tasks: b.tasks.filter(t => t.id !== task.id) } : b
      )
      setTaskBuckets(newBuckets)
    }

    showToast(task ? 'Task updated' : 'Task added', 'success')
    onClose()
  }

  const handleDelete = () => {
    if (!task) return
    if (!confirm('Delete this task?')) return
    const newBuckets = taskBuckets.map((b: TaskBucket) => ({
      ...b, tasks: b.tasks.filter(t => t.id !== task.id)
    }))
    setTaskBuckets(newBuckets)
    showToast('Task deleted')
    onClose()
  }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={`
        fixed z-50 bg-white shadow-2xl flex flex-col
        transition-transform duration-300 ease-in-out
        inset-x-0 bottom-0 rounded-t-2xl max-h-[92dvh]
        lg:inset-y-0 lg:right-0 lg:left-auto lg:w-96 lg:rounded-none lg:max-h-full
        ${open ? 'translate-y-0 lg:translate-x-0' : 'translate-y-full lg:translate-x-full'}
      `}>
        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">{task ? 'Edit Task' : 'New Task'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-4">

          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Task <span className="text-red-400">*</span></label>
            <input ref={titleRef} type="text" value={text} onChange={e => setText(e.target.value)}
              placeholder="What needs to be done?" required
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
          </div>

          {/* Column */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Column</label>
            <select value={targetBucket} onChange={e => setTargetBucket(e.target.value)}
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white">
              {taskBuckets.map((b: TaskBucket) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          {/* Priority */}
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

          {/* Dates */}
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

          {/* Progress */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Progress — {progress}%</label>
              <button type="button"
                onClick={() => { setProgress(progress === 100 ? 0 : 100) }}
                className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                  progress === 100 ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-200 text-slate-500 hover:border-emerald-400 hover:text-emerald-600'
                }`}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Done
              </button>
            </div>
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

          {/* Timeline assignment */}
          {timelines.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Timeline</label>
              <select value={timelineId} onChange={e => setTimelineId(e.target.value)}
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white">
                <option value="">— None —</option>
                {timelines.map(tl => (
                  <option key={tl.id} value={tl.id}>{tl.name}</option>
                ))}
              </select>

              {selectedTimeline && selectedTimeline.swimLanes.length > 0 && (
                <select value={swimLaneId} onChange={e => setSwimLaneId(e.target.value)}
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white">
                  {selectedTimeline.swimLanes.map(l => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Additional details…"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="h-2" />
        </form>

        <div className="flex gap-3 px-4 py-4 border-t border-slate-100 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {task && (
            <button type="button" onClick={handleDelete}
              className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 active:bg-red-100 min-h-[48px] transition-colors">
              Delete
            </button>
          )}
          <button type="submit" onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[48px] transition-colors">
            {task ? 'Save Changes' : 'Add Task'}
          </button>
        </div>
      </div>
    </>
  )
}
