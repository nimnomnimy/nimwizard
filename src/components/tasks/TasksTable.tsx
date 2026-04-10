import { useRef, useState } from 'react'
import type { TaskBucket, Task, SubTask } from '../../types'
import { uid } from '../../lib/utils'

interface Props {
  taskBuckets: TaskBucket[]
  onChange: (buckets: TaskBucket[]) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0]
}

// Inline editable cell — commits on blur or Enter
function EditableCell({
  value,
  placeholder,
  onCommit,
  className = '',
}: {
  value: string
  placeholder?: string
  onCommit: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  function start() {
    setDraft(value)
    setEditing(true)
    setTimeout(() => ref.current?.select(), 0)
  }
  function commit() {
    setEditing(false)
    if (draft !== value) onCommit(draft)
  }

  if (!editing) {
    return (
      <span
        className={`cursor-text hover:bg-slate-100 rounded px-1 py-0.5 transition-colors inline-block min-w-[40px] ${className}`}
        onClick={start}
        title="Click to edit"
      >
        {value || <span className="text-slate-300 italic">{placeholder ?? '—'}</span>}
      </span>
    )
  }
  return (
    <input
      ref={ref}
      autoFocus
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
      className={`border border-blue-400 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white ${className}`}
    />
  )
}

// Date cell
function DateCell({
  value,
  onCommit,
  className = '',
}: {
  value: string
  onCommit: (v: string) => void
  className?: string
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => {
        if (e.target.value) onCommit(e.target.value)
      }}
      className={`border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-transparent cursor-pointer ${className}`}
    />
  )
}

// Progress pill
function ProgressCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 min-w-[60px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-400 rounded-full transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={e => {
          const v = Math.max(0, Math.min(100, Number(e.target.value)))
          onCommit(v)
        }}
        className="w-8 text-[10px] text-slate-500 text-right border border-transparent hover:border-slate-200 focus:border-blue-400 rounded focus:outline-none bg-transparent"
      />
      <span className="text-[10px] text-slate-400">%</span>
    </div>
  )
}

// Priority select
function PriorityCell({
  value,
  onCommit,
}: {
  value: Task['priority']
  onCommit: (v: Task['priority']) => void
}) {
  return (
    <select
      value={value ?? ''}
      onChange={e => onCommit((e.target.value as Task['priority']) || undefined)}
      className="text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1 py-0.5 bg-transparent focus:outline-none cursor-pointer text-slate-600"
    >
      <option value="">—</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
    </select>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TasksTable({ taskBuckets, onChange }: Props) {
  function updateBuckets(buckets: TaskBucket[]) {
    onChange(buckets)
  }

  function patchTask(bucketId: string, taskId: string, patch: Partial<Task>) {
    updateBuckets(
      taskBuckets.map(b =>
        b.id === bucketId
          ? { ...b, tasks: b.tasks.map(t => (t.id === taskId ? { ...t, ...patch } : t)) }
          : b,
      ),
    )
  }

  function addTask(bucketId: string) {
    const task: Task = {
      id: uid(),
      text: '',
      createdAt: Date.now(),
      startDate: today(),
      progress: 0,
    }
    updateBuckets(
      taskBuckets.map(b => (b.id === bucketId ? { ...b, tasks: [...b.tasks, task] } : b)),
    )
  }

  function deleteTask(bucketId: string, taskId: string) {
    updateBuckets(
      taskBuckets.map(b =>
        b.id === bucketId ? { ...b, tasks: b.tasks.filter(t => t.id !== taskId) } : b,
      ),
    )
  }

  function patchSubTask(bucketId: string, taskId: string, subId: string, patch: Partial<SubTask>) {
    updateBuckets(
      taskBuckets.map(b =>
        b.id === bucketId
          ? {
              ...b,
              tasks: b.tasks.map(t =>
                t.id === taskId
                  ? {
                      ...t,
                      subTasks: (t.subTasks ?? []).map(s =>
                        s.id === subId ? { ...s, ...patch } : s,
                      ),
                    }
                  : t,
              ),
            }
          : b,
      ),
    )
  }

  function addSubTask(bucketId: string, taskId: string) {
    const sub: SubTask = {
      id: uid(),
      text: '',
      progress: 0,
      done: false,
    }
    updateBuckets(
      taskBuckets.map(b =>
        b.id === bucketId
          ? {
              ...b,
              tasks: b.tasks.map(t =>
                t.id === taskId ? { ...t, subTasks: [...(t.subTasks ?? []), sub] } : t,
              ),
            }
          : b,
      ),
    )
  }

  function deleteSubTask(bucketId: string, taskId: string, subId: string) {
    updateBuckets(
      taskBuckets.map(b =>
        b.id === bucketId
          ? {
              ...b,
              tasks: b.tasks.map(t =>
                t.id === taskId
                  ? { ...t, subTasks: (t.subTasks ?? []).filter(s => s.id !== subId) }
                  : t,
              ),
            }
          : b,
      ),
    )
  }

  const COL_TH =
    'text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-2 whitespace-nowrap'
  const CELL = 'px-2 py-1.5 text-xs text-slate-700 align-middle'

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className="text-slate-400"
        >
          <rect x="1" y="1" width="10" height="2" rx="0.5" fill="currentColor" />
          <rect x="1" y="5" width="10" height="2" rx="0.5" fill="currentColor" />
          <rect x="1" y="9" width="10" height="2" rx="0.5" fill="currentColor" />
        </svg>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Table View</span>
        <span className="text-[10px] text-slate-400 ml-1">— click any cell to edit</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className={`${COL_TH} w-6`} />
              <th className={`${COL_TH} min-w-[180px]`}>Task / Subtask</th>
              <th className={`${COL_TH} w-24`}>Priority</th>
              <th className={`${COL_TH} w-28`}>Start</th>
              <th className={`${COL_TH} w-28`}>Due</th>
              <th className={`${COL_TH} w-28`}>Progress</th>
              <th className={`${COL_TH} w-10`}>Done</th>
              <th className={`${COL_TH} min-w-[120px]`}>Notes</th>
              <th className={`${COL_TH} w-6`} />
            </tr>
          </thead>
          <tbody>
            {taskBuckets.map(bucket => (
              <BucketSection
                key={bucket.id}
                bucket={bucket}
                onPatchTask={(taskId, patch) => patchTask(bucket.id, taskId, patch)}
                onAddTask={() => addTask(bucket.id)}
                onDeleteTask={taskId => {
                  if (confirm('Delete this task?')) deleteTask(bucket.id, taskId)
                }}
                onPatchSubTask={(taskId, subId, patch) =>
                  patchSubTask(bucket.id, taskId, subId, patch)
                }
                onAddSubTask={taskId => addSubTask(bucket.id, taskId)}
                onDeleteSubTask={(taskId, subId) => deleteSubTask(bucket.id, taskId, subId)}
                CELL={CELL}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Bucket section ─────────────────────────────────────────────────────────────

interface BucketSectionProps {
  bucket: TaskBucket
  onPatchTask: (taskId: string, patch: Partial<Task>) => void
  onAddTask: () => void
  onDeleteTask: (taskId: string) => void
  onPatchSubTask: (taskId: string, subId: string, patch: Partial<SubTask>) => void
  onAddSubTask: (taskId: string) => void
  onDeleteSubTask: (taskId: string, subId: string) => void
  CELL: string
}

function BucketSection({
  bucket,
  onPatchTask,
  onAddTask,
  onDeleteTask,
  onPatchSubTask,
  onAddSubTask,
  onDeleteSubTask,
  CELL,
}: BucketSectionProps) {
  return (
    <>
      {/* Bucket header row */}
      <tr>
        <td colSpan={9} className="px-2 pt-3 pb-0.5">
          <div className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: bucket.color }}
            />
            <span
              className="text-[10px] font-bold uppercase tracking-wide"
              style={{ color: bucket.color }}
            >
              {bucket.name}
            </span>
            <div
              className="h-px flex-1"
              style={{ backgroundColor: bucket.color, opacity: 0.2 }}
            />
          </div>
        </td>
      </tr>

      {/* Task rows */}
      {bucket.tasks.map(task => (
        <TaskRow
          key={task.id}
          task={task}
          onPatch={patch => onPatchTask(task.id, patch)}
          onDelete={() => onDeleteTask(task.id)}
          onAddSubTask={() => onAddSubTask(task.id)}
          onPatchSubTask={(subId, patch) => onPatchSubTask(task.id, subId, patch)}
          onDeleteSubTask={subId => onDeleteSubTask(task.id, subId)}
          CELL={CELL}
        />
      ))}

      {/* Add task row */}
      <tr className="border-b border-slate-100">
        <td colSpan={9} className="px-2 py-1">
          <button
            onClick={onAddTask}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-blue-500 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path
                d="M4.5 1v7M1 4.5h7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Add task to {bucket.name}
          </button>
        </td>
      </tr>
    </>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task
  onPatch: (patch: Partial<Task>) => void
  onDelete: () => void
  onAddSubTask: () => void
  onPatchSubTask: (subId: string, patch: Partial<SubTask>) => void
  onDeleteSubTask: (subId: string) => void
  CELL: string
}

function TaskRow({
  task,
  onPatch,
  onDelete,
  onAddSubTask,
  onPatchSubTask,
  onDeleteSubTask,
  CELL,
}: TaskRowProps) {
  const subTasks = task.subTasks ?? []

  return (
    <>
      <tr className="group border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
        {/* Color dot / icon */}
        <td className={`${CELL} text-center`}>
          <div
            className="w-2 h-2 rounded-full inline-block bg-slate-300"
          />
        </td>
        {/* Task text */}
        <td className={`${CELL} font-medium`}>
          <EditableCell
            value={task.text}
            placeholder="Task name"
            onCommit={v => onPatch({ text: v })}
            className="w-full"
          />
        </td>
        {/* Priority */}
        <td className={CELL}>
          <PriorityCell value={task.priority} onCommit={v => onPatch({ priority: v })} />
        </td>
        {/* Start */}
        <td className={CELL}>
          <DateCell value={task.startDate ?? ''} onCommit={v => onPatch({ startDate: v })} />
        </td>
        {/* Due */}
        <td className={CELL}>
          <DateCell value={task.due ?? ''} onCommit={v => onPatch({ due: v })} />
        </td>
        {/* Progress */}
        <td className={CELL}>
          <ProgressCell value={task.progress ?? 0} onCommit={v => onPatch({ progress: v })} />
        </td>
        {/* Done */}
        <td className={`${CELL} text-center`}>
          <span className="text-slate-300 text-xs">—</span>
        </td>
        {/* Notes */}
        <td className={CELL}>
          <EditableCell
            value={task.notes ?? ''}
            placeholder="Notes…"
            onCommit={v => onPatch({ notes: v })}
          />
        </td>
        {/* Actions */}
        <td className={`${CELL} whitespace-nowrap`}>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
            <button
              onClick={onAddSubTask}
              title="Add subtask"
              className="p-1 text-slate-300 hover:text-blue-400 rounded transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path
                  d="M2 1v6a1 1 0 001 1h5.5M9 7l1.5 1.5L9 10"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 4.5h3M8.5 3v3"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <button
              onClick={onDelete}
              title="Delete task"
              className="p-1 text-slate-300 hover:text-red-400 rounded transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path
                  d="M1 3h10M4.5 3V2h3v1M2.5 3l.8 7h5.4l.8-7"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {/* Subtask rows */}
      {subTasks.map((sub, si) => (
        <SubTaskRow
          key={sub.id}
          sub={sub}
          isLast={si === subTasks.length - 1}
          onPatch={patch => onPatchSubTask(sub.id, patch)}
          onDelete={() => onDeleteSubTask(sub.id)}
          CELL={CELL}
        />
      ))}
    </>
  )
}

// ── SubTask row ───────────────────────────────────────────────────────────────

interface SubTaskRowProps {
  sub: SubTask
  isLast: boolean
  onPatch: (patch: Partial<SubTask>) => void
  onDelete: () => void
  CELL: string
}

function SubTaskRow({ sub, isLast, onPatch, onDelete, CELL }: SubTaskRowProps) {
  return (
    <tr className="group border-b border-slate-50 hover:bg-indigo-50/20 transition-colors">
      {/* Indent + connector */}
      <td className={`${CELL} text-center`}>
        <div className="flex items-center justify-end pr-0.5">
          <svg
            width="14"
            height="16"
            viewBox="0 0 14 16"
            fill="none"
            className="text-slate-200"
          >
            <path d={`M4 0 L4 ${isLast ? 10 : 16}`} stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 10 L11 10" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      </td>
      {/* Subtask text */}
      <td className={`${CELL} pl-5`}>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-50 bg-slate-400" />
          <EditableCell
            value={sub.text}
            placeholder="Subtask name"
            onCommit={v => onPatch({ text: v })}
          />
          {sub.done && (
            <span className="text-[9px] text-emerald-500 font-bold flex-shrink-0">✓</span>
          )}
        </div>
      </td>
      {/* Priority */}
      <td className={CELL}>
        <PriorityCell value={sub.priority} onCommit={v => onPatch({ priority: v })} />
      </td>
      {/* Start — subtasks don't have startDate in most cases */}
      <td className={CELL}>
        <span className="text-slate-300 text-xs italic">—</span>
      </td>
      {/* Due */}
      <td className={CELL}>
        <DateCell value={sub.due ?? ''} onCommit={v => onPatch({ due: v })} />
      </td>
      {/* Progress */}
      <td className={CELL}>
        <ProgressCell value={sub.progress ?? 0} onCommit={v => onPatch({ progress: v })} />
      </td>
      {/* Done */}
      <td className={`${CELL} text-center`}>
        <input
          type="checkbox"
          checked={sub.done ?? false}
          onChange={e => onPatch({ done: e.target.checked })}
          className="w-3.5 h-3.5 rounded accent-indigo-500 cursor-pointer"
        />
      </td>
      {/* Notes */}
      <td className={CELL}>
        <EditableCell
          value={sub.notes ?? ''}
          placeholder="Notes…"
          onCommit={v => onPatch({ notes: v })}
        />
      </td>
      {/* Delete */}
      <td className={CELL}>
        <button
          onClick={onDelete}
          title="Delete subtask"
          className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-400 rounded transition-all"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M1 3h10M4.5 3V2h3v1M2.5 3l.8 7h5.4l.8-7"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </td>
    </tr>
  )
}
