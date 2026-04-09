import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import TaskCard from '../components/tasks/TaskCard'
import TaskDrawer from '../components/tasks/TaskDrawer'
import SubTaskDrawer from '../components/tasks/SubTaskDrawer'
import type { Task, TaskBucket, SubTask } from '../types'

const BUCKET_COLORS = [
  '#a78bfa','#94a3b8','#f59e0b','#10b981',
  '#3b82f6','#ef4444','#ec4899','#06b6d4','#84cc16','#f97316',
]
const DEFAULT_BUCKET_IDS = ['unsorted','backlog','inprogress','done']

type Priority = 'low' | 'medium' | 'high'
type DueFilter = 'none' | 'today' | 'this-week' | 'overdue'

function isOverdue(due: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return new Date(due + 'T00:00:00') < today
}
function isToday(due: string) {
  const today = new Date().toISOString().split('T')[0]
  return due === today
}
function isThisWeek(due: string) {
  const today = new Date(); today.setHours(0,0,0,0)
  const end = new Date(today); end.setDate(end.getDate() + 7)
  const d = new Date(due + 'T00:00:00')
  return d >= today && d <= end
}

interface DrawerState { bucketId: string; task: Task | null }
interface SubDrawerState { bucketId: string; task: Task; sub: SubTask | null }

export default function TasksPage() {
  const taskBuckets = useAppStore(s => s.taskBuckets)
  const setTaskBuckets = useAppStore(s => s.setTaskBuckets)

  const [search, setSearch] = useState('')
  const [priorities, setPriorities] = useState<Set<Priority>>(new Set())
  const [dueFilters, setDueFilters] = useState<Set<DueFilter>>(new Set())
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  const [subDrawer, setSubDrawer] = useState<SubDrawerState | null>(null)
  const [activeBucket, setActiveBucket] = useState(taskBuckets[0]?.id ?? '')

  // Bucket management state
  const [showManage, setShowManage] = useState(false)
  const [editingBucket, setEditingBucket] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState(BUCKET_COLORS[0])
  const [newBucketName, setNewBucketName] = useState('')
  const [showAddBucket, setShowAddBucket] = useState(false)

  const startEdit = (b: TaskBucket) => { setEditingBucket(b.id); setEditName(b.name); setEditColor(b.color) }
  const saveEdit = () => {
    if (!editName.trim() || !editingBucket) return
    setTaskBuckets(taskBuckets.map(b => b.id === editingBucket ? { ...b, name: editName.trim(), color: editColor } : b))
    setEditingBucket(null)
    showToast('Column updated', 'success')
  }
  const deleteBucket = (id: string) => {
    const b = taskBuckets.find(x => x.id === id)
    if (!b) return
    if (DEFAULT_BUCKET_IDS.includes(id)) { showToast('Cannot delete default columns'); return }
    if (!confirm(`Delete "${b.name}"?${b.tasks.length ? ` ${b.tasks.length} task(s) will move to Unsorted.` : ''}`)) return
    const newBuckets = taskBuckets.filter(x => x.id !== id).map(x =>
      x.id === 'unsorted' ? { ...x, tasks: [...x.tasks, ...b.tasks] } : x
    )
    setTaskBuckets(newBuckets)
    setEditingBucket(null)
    if (activeBucket === id) setActiveBucket('unsorted')
    showToast(`"${b.name}" deleted`)
  }
  const addBucket = () => {
    if (!newBucketName.trim()) return
    const color = BUCKET_COLORS[taskBuckets.length % BUCKET_COLORS.length]
    setTaskBuckets([...taskBuckets, { id: uid(), name: newBucketName.trim(), color, tasks: [] }])
    setNewBucketName('')
    setShowAddBucket(false)
    showToast('Column added', 'success')
  }
  const moveBucket = (id: string, dir: -1 | 1) => {
    const idx = taskBuckets.findIndex(b => b.id === id)
    if (idx < 0) return
    const next = idx + dir
    if (next < 0 || next >= taskBuckets.length) return
    const copy = [...taskBuckets];
    [copy[idx], copy[next]] = [copy[next], copy[idx]]
    setTaskBuckets(copy)
  }

  const togglePriority = (p: Priority) => {
    setPriorities(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n })
  }
  const toggleDue = (d: DueFilter) => {
    setDueFilters(prev => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n })
  }

  const matchesFilter = (task: Task, bucketId: string) => {
    if (search) {
      const q = search.toLowerCase()
      if (!task.text.toLowerCase().includes(q) && !(task.notes ?? '').toLowerCase().includes(q)) return false
    }
    if (priorities.size > 0 && !priorities.has(task.priority as Priority)) return false
    if (dueFilters.size > 0) {
      const matches = [...dueFilters].some(f => {
        if (f === 'none') return !task.due
        if (!task.due) return false
        if (f === 'overdue') return isOverdue(task.due) && bucketId !== 'done'
        if (f === 'today') return isToday(task.due)
        if (f === 'this-week') return isThisWeek(task.due)
        return false
      })
      if (!matches) return false
    }
    return true
  }

  const moveTask = (taskId: string, fromBucketId: string, toBucketId: string) => {
    const newBuckets = taskBuckets.map((b: TaskBucket) => {
      if (b.id === fromBucketId) return { ...b, tasks: b.tasks.filter(t => t.id !== taskId) }
      if (b.id === toBucketId) {
        const task = taskBuckets.find((b: TaskBucket) => b.id === fromBucketId)?.tasks.find(t => t.id === taskId)
        if (task) return { ...b, tasks: [...b.tasks, task] }
      }
      return b
    })
    setTaskBuckets(newBuckets)
    showToast('Task moved', 'success')
  }

  const deleteTask = (taskId: string, bucketId: string) => {
    if (!confirm('Delete this task?')) return
    const newBuckets = taskBuckets.map((b: TaskBucket) =>
      b.id === bucketId ? { ...b, tasks: b.tasks.filter(t => t.id !== taskId) } : b
    )
    setTaskBuckets(newBuckets)
    showToast('Task deleted')
  }


  const saveSubTask = (sub: SubTask) => {
    if (!subDrawer) return
    const { bucketId, task } = subDrawer
    const existing = (task.subTasks ?? []).some(s => s.id === sub.id)
    const newSubTasks = existing
      ? (task.subTasks ?? []).map(s => s.id === sub.id ? sub : s)
      : [...(task.subTasks ?? []), sub]
    const updatedTask = { ...task, subTasks: newSubTasks }
    setTaskBuckets(taskBuckets.map(b =>
      b.id === bucketId ? { ...b, tasks: b.tasks.map(t => t.id === task.id ? updatedTask : t) } : b
    ))
    setSubDrawer(null)
    showToast(existing ? 'Sub-task updated' : 'Sub-task added', 'success')
  }

  const deleteSubTask = (subId: string) => {
    if (!subDrawer) return
    const { bucketId, task } = subDrawer
    const updatedTask = { ...task, subTasks: (task.subTasks ?? []).filter(s => s.id !== subId) }
    setTaskBuckets(taskBuckets.map(b =>
      b.id === bucketId ? { ...b, tasks: b.tasks.map(t => t.id === task.id ? updatedTask : t) } : b
    ))
    setSubDrawer(null)
    showToast('Sub-task deleted')
  }

  const allTasks = taskBuckets.flatMap(b => b.tasks)
  const hasFilters = search || priorities.size > 0 || dueFilters.size > 0

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-slate-900">Tasks</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowManage(m => !m); setEditingBucket(null); setShowAddBucket(false) }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-semibold min-h-[44px] transition-colors ${showManage ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="7" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="1" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="7" y="7" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
              </svg>
              Columns
            </button>
            <button onClick={() => setDrawer({ bucketId: activeBucket || taskBuckets[0]?.id, task: null })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              Add
            </button>
          </div>
        </div>

        {/* Manage columns panel */}
        {showManage && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl mb-3 overflow-hidden">
            {taskBuckets.map((b, i) => {
              const isEditing = editingBucket === b.id
              const isDefault = DEFAULT_BUCKET_IDS.includes(b.id)
              return (
                <div key={b.id} className="border-b border-slate-200 last:border-0 bg-white">
                  {isEditing ? (
                    <div className="px-3 py-3 flex flex-col gap-2">
                      <input autoFocus type="text" value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingBucket(null) }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px]" />
                      <div className="flex gap-1.5 flex-wrap">
                        {BUCKET_COLORS.map(c => (
                          <button key={c} type="button" onClick={() => setEditColor(c)}
                            className={`w-5 h-5 rounded-full border-2 transition-transform ${editColor === c ? 'scale-125 border-slate-500' : 'border-transparent hover:scale-110'}`}
                            style={{ background: c }} />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="flex-1 py-2 rounded-lg bg-blue-500 text-white text-xs font-semibold min-h-[36px]">Save</button>
                        {!isDefault && <button onClick={() => deleteBucket(b.id)} className="px-3 py-2 rounded-lg border border-red-200 text-red-500 text-xs font-medium min-h-[36px]">Delete</button>}
                        <button onClick={() => setEditingBucket(null)} className="px-3 py-2 rounded-lg border border-slate-200 text-slate-500 text-xs min-h-[36px]">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2.5 min-h-[44px]">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: b.color }} />
                      <span className="flex-1 text-sm font-medium text-slate-700">{b.name}</span>
                      <span className="text-xs text-slate-400">{b.tasks.length}</span>
                      <div className="flex flex-col">
                        <button onClick={() => moveBucket(b.id, -1)} disabled={i === 0} className="h-4 text-slate-300 hover:text-slate-500 disabled:opacity-20 flex items-center justify-center">
                          <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 5l3.5-3.5L8 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        </button>
                        <button onClick={() => moveBucket(b.id, 1)} disabled={i === taskBuckets.length - 1} className="h-4 text-slate-300 hover:text-slate-500 disabled:opacity-20 flex items-center justify-center">
                          <svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                      <button onClick={() => startEdit(b)} className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5l2 2-6 6H2.5v-2l6-6z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {/* Add new */}
            {showAddBucket ? (
              <div className="flex gap-2 px-3 py-2.5 border-t border-slate-200 bg-white">
                <input autoFocus type="text" value={newBucketName} onChange={e => setNewBucketName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addBucket(); if (e.key === 'Escape') setShowAddBucket(false) }}
                  placeholder="Column name…"
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px]" />
                <button onClick={addBucket} className="px-3 py-2 rounded-lg bg-blue-500 text-white text-xs font-semibold min-h-[40px]">Add</button>
                <button onClick={() => setShowAddBucket(false)} className="px-2 py-2 rounded-lg border border-slate-200 text-slate-400 text-sm min-h-[40px]">✕</button>
              </div>
            ) : (
              <button onClick={() => setShowAddBucket(true)}
                className="w-full text-left px-3 py-2.5 text-xs font-semibold text-blue-500 hover:bg-blue-50 border-t border-slate-200 min-h-[40px] transition-colors">
                + Add column
              </button>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative mb-2.5">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 min-h-[44px]" />
        </div>

        {/* Filter pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
          {(['low','medium','high'] as Priority[]).map(p => (
            <button key={p} onClick={() => togglePriority(p)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors min-h-[32px] flex-shrink-0 ${
                priorities.has(p) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-500 border-slate-200'
              }`}>
              {p}
            </button>
          ))}
          <div className="w-px bg-slate-200 flex-shrink-0 mx-0.5" />
          {([['none','No due'],['today','Today'],['this-week','This week'],['overdue','Overdue']] as [DueFilter, string][]).map(([val, label]) => (
            <button key={val} onClick={() => toggleDue(val)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors min-h-[32px] flex-shrink-0 ${
                dueFilters.has(val) ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-500 border-slate-200'
              }`}>
              {label}
            </button>
          ))}
          {hasFilters && (
            <button onClick={() => { setSearch(''); setPriorities(new Set()); setDueFilters(new Set()) }}
              className="px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border border-slate-200 bg-white text-slate-400 min-h-[32px] flex-shrink-0">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Mobile: bucket tabs */}
      <div className="lg:hidden flex bg-white border-b border-slate-200 overflow-x-auto flex-shrink-0">
        {taskBuckets.map((b: TaskBucket) => {
          const count = b.tasks.filter(t => matchesFilter(t, b.id)).length
          return (
            <button key={b.id} onClick={() => { setActiveBucket(b.id) }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex-shrink-0 min-h-[44px] ${
                activeBucket === b.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'
              }`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: b.color }} />
              {b.name}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeBucket === b.id ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden">

        {/* Desktop: all columns side by side */}
        <div className="hidden lg:flex h-full gap-4 p-4 overflow-x-auto">
          {taskBuckets.map((b: TaskBucket) => {
            const tasks = b.tasks.filter(t => matchesFilter(t, b.id))
            return (
              <div key={b.id} className="flex flex-col w-64 flex-shrink-0">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.color }} />
                  <span className="text-sm font-bold text-slate-700">{b.name}</span>
                  <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{tasks.length}</span>
                  <button onClick={() => setDrawer({ bucketId: b.id, task: null })}
                    className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-colors">
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto scroll-touch flex flex-col gap-2 pr-0.5">
                  {tasks.length === 0 && (
                    <div className="text-center py-8 text-slate-300 text-sm">No tasks</div>
                  )}
                  {tasks.map(t => (
                    <div key={t.id}>
                      <TaskCard task={t} bucketId={b.id}
                        buckets={taskBuckets}
                        onEdit={() => setDrawer({ bucketId: b.id, task: t })}
                        onDelete={() => deleteTask(t.id, b.id)}
                        onMove={toBucketId => moveTask(t.id, b.id, toBucketId)}
                        onEditSubTask={sub => setSubDrawer({ bucketId: b.id, task: t, sub })} />
                      <button
                        onClick={() => setSubDrawer({ bucketId: b.id, task: t, sub: null })}
                        className="w-full text-left text-[11px] text-slate-400 hover:text-blue-500 px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center gap-1.5 rounded-b-xl">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        Add sub-task
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Mobile: single column view */}
        <div className="lg:hidden h-full overflow-y-auto scroll-touch px-4 py-3 flex flex-col gap-2">
          {(() => {
            const bucket = taskBuckets.find((b: TaskBucket) => b.id === activeBucket)
            if (!bucket) return null
            const tasks = bucket.tasks.filter(t => matchesFilter(t, bucket.id))
            return tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <rect x="8" y="6" width="24" height="28" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M14 14h12M14 20h12M14 26h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p className="text-sm">{hasFilters ? 'No matching tasks' : 'No tasks in this column'}</p>
                <button onClick={() => setDrawer({ bucketId: bucket.id, task: null })}
                  className="px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-semibold min-h-[44px]">
                  Add task
                </button>
              </div>
            ) : tasks.map(t => (
              <div key={t.id}>
                <TaskCard task={t} bucketId={bucket.id}
                  buckets={taskBuckets}
                  onEdit={() => setDrawer({ bucketId: bucket.id, task: t })}
                  onDelete={() => deleteTask(t.id, bucket.id)}
                  onMove={toBucketId => moveTask(t.id, bucket.id, toBucketId)}
                  onEditSubTask={sub => setSubDrawer({ bucketId: bucket.id, task: t, sub })} />
                <button
                  onClick={() => setSubDrawer({ bucketId: bucket.id, task: t, sub: null })}
                  className="w-full text-left text-[11px] text-slate-400 hover:text-blue-500 px-3 py-1.5 hover:bg-blue-50 transition-colors flex items-center gap-1.5 rounded-b-xl mb-1">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add sub-task
                </button>
              </div>
            ))
          })()}
          <div className="h-4" />
        </div>
      </div>

      <TaskDrawer
        open={!!drawer}
        bucketId={drawer?.bucketId ?? taskBuckets[0]?.id ?? ''}
        task={drawer?.task ?? null}
        onClose={() => setDrawer(null)} />

      <SubTaskDrawer
        open={!!subDrawer}
        subTask={subDrawer?.sub ?? null}
        parentTask={subDrawer?.task ?? null}
        allTasks={allTasks}
        onSave={saveSubTask}
        onDelete={deleteSubTask}
        onClose={() => setSubDrawer(null)} />
    </div>
  )
}
