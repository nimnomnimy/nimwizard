import { useState, useEffect } from 'react'
import type { Task, SubTask } from '../../types'
import { useAppStore } from '../../store/useAppStore'

interface Props {
  task: Task
  bucketId: string
  onEdit: () => void
  onDelete: () => void
  onMove: (toBucketId: string) => void
  onEditSubTask?: (sub: SubTask) => void
  buckets: Array<{ id: string; name: string; color: string }>
}

const PRIORITY_STYLES: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  low:    'bg-emerald-400',
}

const PRIORITY_TEXT: Record<string, string> = {
  high:   'text-red-600 bg-red-50',
  medium: 'text-amber-600 bg-amber-50',
  low:    'text-emerald-600 bg-emerald-50',
}

function isOverdue(due: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(due + 'T00:00:00') < today
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y.slice(2)}`
}

export default function TaskCard({ task, bucketId, onEdit, onDelete, onMove, onEditSubTask, buckets }: Props) {
  const overdue = task.due && isOverdue(task.due) && bucketId !== 'done'
  const otherBuckets = buckets.filter(b => b.id !== bucketId)
  const progress = task.progress ?? 0
  const subTasks = task.subTasks ?? []
  const [collapsed, setCollapsed] = useState(task.collapsed ?? false)
  const saveSubTaskWithTimelineSync = useAppStore(s => s.saveSubTaskWithTimelineSync)

  // When subtasks are added externally, auto-expand
  useEffect(() => {
    if (subTasks.length > 0) setCollapsed(false)
  }, [subTasks.length])

  function toggleSubTaskDone(sub: SubTask) {
    const updated = { ...sub, done: !sub.done }
    saveSubTaskWithTimelineSync(bucketId, task.id, updated, updated.id)
  }

  return (
    <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm ${bucketId === 'done' ? 'opacity-60' : ''}`}>
      {/* Priority bar */}
      <div className={`h-0.5 ${PRIORITY_STYLES[task.priority ?? 'medium'] ?? 'bg-slate-300'}`} />

      <div className="p-3">
        {/* Title row */}
        <div className="flex items-start gap-2 mb-1.5">
          {subTasks.length > 0 && (
            <button
              onClick={() => setCollapsed(c => !c)}
              className="mt-0.5 flex-shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"
                style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              </svg>
            </button>
          )}
          <p className={`flex-1 text-sm font-medium text-slate-900 leading-snug ${bucketId === 'done' ? 'line-through text-slate-400' : ''}`}>
            {task.text}
          </p>
        </div>

        {/* Notes preview */}
        {task.notes && (
          <p className="text-xs text-slate-400 mb-2 line-clamp-2">{task.notes}</p>
        )}

        {/* Progress bar */}
        {progress > 0 && (
          <div className="mb-2">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-slate-400 font-medium">Progress</span>
              <span className="text-[10px] text-slate-500 font-semibold">{progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progress}%`,
                  backgroundColor: progress === 100 ? '#10b981' : progress >= 50 ? '#3b82f6' : '#f59e0b',
                }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {task.priority && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_TEXT[task.priority]}`}>
                {task.priority}
              </span>
            )}
            {(task.startDate || task.due) && (
              <span className={`text-[11px] font-medium ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
                {overdue ? '⚠ ' : ''}
                {task.startDate && task.due
                  ? `${fmtDate(task.startDate)} – ${fmtDate(task.due)}`
                  : task.due ? fmtDate(task.due) : fmtDate(task.startDate!)}
              </span>
            )}
            {subTasks.length > 0 && (
              <span className="text-[10px] text-slate-400">
                {subTasks.filter(s => s.done).length}/{subTasks.length} subtasks
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {otherBuckets.length > 0 && (
              <select
                value=""
                onChange={e => { if (e.target.value) onMove(e.target.value) }}
                className="text-[11px] text-slate-400 border-0 bg-transparent cursor-pointer pr-1 focus:outline-none min-h-[36px]"
                title="Move to…"
              >
                <option value="" disabled>Move…</option>
                {otherBuckets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            <button onClick={onEdit}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M9.5 1.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button onClick={onDelete}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-tasks */}
      {!collapsed && subTasks.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50/50">
          {subTasks.map(sub => (
            <SubTaskRow
              key={sub.id}
              sub={sub}
              isDone={bucketId === 'done'}
              onToggleDone={() => toggleSubTaskDone(sub)}
              onEdit={() => onEditSubTask?.(sub)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubTaskRow({ sub, isDone, onToggleDone, onEdit }: {
  sub: SubTask
  isDone: boolean
  onToggleDone: () => void
  onEdit: () => void
}) {
  const overdue = sub.due && !sub.done && isOverdue(sub.due)

  return (
    <button
      onClick={onEdit}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-100 active:bg-slate-200 transition-colors border-b border-slate-100 last:border-0 min-h-[44px]"
    >
      {/* Done toggle */}
      <span
        role="checkbox"
        aria-checked={!!sub.done}
        onClick={e => { e.stopPropagation(); onToggleDone() }}
        className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          sub.done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-blue-400'
        }`}
      >
        {sub.done && (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M1.5 4.5l2 2 4-4" stroke="white" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </span>

      <span className={`flex-1 text-xs font-medium truncate ${sub.done || isDone ? 'line-through text-slate-400' : 'text-slate-700'}`}>
        {sub.text}
      </span>

      {sub.priority && (
        <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full flex-shrink-0 ${
          sub.priority === 'high' ? 'text-red-600 bg-red-50' : sub.priority === 'medium' ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50'
        }`}>{sub.priority}</span>
      )}

      {sub.due && (
        <span className={`text-[10px] flex-shrink-0 ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
          {fmtDate(sub.due)}
        </span>
      )}

      {(sub.progress ?? 0) > 0 && (
        <div className="w-12 h-1 bg-slate-200 rounded-full overflow-hidden flex-shrink-0">
          <div className="h-full rounded-full bg-blue-400" style={{ width: `${sub.progress}%` }} />
        </div>
      )}

      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-slate-300 flex-shrink-0">
        <path d="M3 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      </svg>
    </button>
  )
}
