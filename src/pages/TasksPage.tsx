import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { showToast } from '../components/ui/Toast'
import TaskCard from '../components/tasks/TaskCard'
import TaskDrawer from '../components/tasks/TaskDrawer'
import type { Task, TaskBucket } from '../types'

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

export default function TasksPage() {
  const taskBuckets = useAppStore(s => s.taskBuckets)
  const setTaskBuckets = useAppStore(s => s.setTaskBuckets)

  const [search, setSearch] = useState('')
  const [priorities, setPriorities] = useState<Set<Priority>>(new Set())
  const [dueFilters, setDueFilters] = useState<Set<DueFilter>>(new Set())
  const [drawer, setDrawer] = useState<DrawerState | null>(null)
  // Mobile: which bucket tab is active
  const [activeBucket, setActiveBucket] = useState(taskBuckets[0]?.id ?? '')

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


  const hasFilters = search || priorities.size > 0 || dueFilters.size > 0

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-slate-900">Tasks</h1>
          <button onClick={() => setDrawer({ bucketId: activeBucket || taskBuckets[0]?.id, task: null })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 active:bg-blue-700 min-h-[44px] transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            Add
          </button>
        </div>

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
                    <TaskCard key={t.id} task={t} bucketId={b.id}
                      buckets={taskBuckets}
                      onEdit={() => setDrawer({ bucketId: b.id, task: t })}
                      onDelete={() => deleteTask(t.id, b.id)}
                      onMove={toBucketId => moveTask(t.id, b.id, toBucketId)} />
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
              <TaskCard key={t.id} task={t} bucketId={bucket.id}
                buckets={taskBuckets}
                onEdit={() => setDrawer({ bucketId: bucket.id, task: t })}
                onDelete={() => deleteTask(t.id, bucket.id)}
                onMove={toBucketId => moveTask(t.id, bucket.id, toBucketId)} />
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
    </div>
  )
}
