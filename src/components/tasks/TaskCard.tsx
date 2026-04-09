import type { Task } from '../../types'

interface Props {
  task: Task
  bucketId: string
  onEdit: () => void
  onDelete: () => void
  onMove: (toBucketId: string) => void
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

export default function TaskCard({ task, bucketId, onEdit, onDelete, onMove, buckets }: Props) {
  const overdue = task.due && isOverdue(task.due) && bucketId !== 'done'
  const otherBuckets = buckets.filter(b => b.id !== bucketId)

  return (
    <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm ${bucketId === 'done' ? 'opacity-60' : ''}`}>
      {/* Priority bar */}
      <div className={`h-0.5 ${PRIORITY_STYLES[task.priority ?? 'medium'] ?? 'bg-slate-300'}`} />

      <div className="p-3">
        {/* Title */}
        <p className={`text-sm font-medium text-slate-900 leading-snug mb-2 ${bucketId === 'done' ? 'line-through text-slate-400' : ''}`}>
          {task.text}
        </p>

        {/* Notes preview */}
        {task.notes && (
          <p className="text-xs text-slate-400 mb-2 line-clamp-2">{task.notes}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {task.priority && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_TEXT[task.priority]}`}>
                {task.priority}
              </span>
            )}
            {task.due && (
              <span className={`text-[11px] font-medium ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
                {overdue ? '⚠ ' : ''}{fmtDate(task.due)}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            {/* Move to bucket */}
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
    </div>
  )
}
