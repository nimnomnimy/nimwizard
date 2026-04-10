import { useState, useEffect } from 'react'
import type { TimelineItem, TimelineMilestone, SwimLane, Timescale, TimelineSubItem } from '../../types'
import type { Task } from '../../types'
import { formatDate, addDays } from './utils/dateLayout'
import { uid } from '../../lib/utils'
import { useAppStore } from '../../store/useAppStore'

const BAR_COLORS = [
  '#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b',
]

const MILESTONE_COLORS = [
  '#ef4444','#f59e0b','#8b5cf6','#ec4899','#6366f1',
  '#3b82f6','#10b981','#14b8a6','#f97316',
]

interface TaskWithBucket extends Task { bucketName: string }

interface Props {
  open: boolean
  item: TimelineItem | null
  milestone: TimelineMilestone | null
  laneId: string | null
  swimLanes: SwimLane[]
  timescale?: Timescale
  allTasks?: TaskWithBucket[]
  allItems?: TimelineItem[]   // for predecessor selection
  onSaveItem: (item: TimelineItem) => void
  onDeleteItem: (id: string) => void
  onSaveMilestone: (m: TimelineMilestone) => void
  onDeleteMilestone: (id: string) => void
  onClose: () => void
}

export default function ItemDrawer({
  open, item, milestone, laneId, swimLanes, allTasks = [], allItems = [],
  onSaveItem, onDeleteItem, onSaveMilestone, onDeleteMilestone, onClose,
}: Props) {
  const taskBuckets = useAppStore(s => s.taskBuckets)
  const updateTask  = useAppStore(s => s.updateTask)
  // ── Item form state ────────────────────────────────────────────────────────
  const [label,     setLabel]     = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [color,     setColor]     = useState('#6366f1')
  const [progress,  setProgress]  = useState(0)
  const [notes,     setNotes]     = useState('')
  const [laneIdSt,  setLaneIdSt]  = useState(laneId ?? swimLanes[0]?.id ?? '')
  const [itemType,  setItemType]  = useState<'bar' | 'milestone'>('bar')
  const [taskId,    setTaskId]    = useState<string>('')
  const [subItems,  setSubItems]  = useState<TimelineSubItem[]>([])
  const [predIds,   setPredIds]   = useState<string[]>([])

  // ── Milestone form state ───────────────────────────────────────────────────
  const [msLabel, setMsLabel] = useState('')
  const [msDate,  setMsDate]  = useState('')
  const [msColor, setMsColor] = useState('#ef4444')

  const isMilestone = !!milestone && !item

  useEffect(() => {
    if (!open) return
    if (milestone && !item) {
      setMsLabel(milestone.label)
      setMsDate(milestone.date)
      setMsColor(milestone.color)
    } else if (item) {
      setLabel(item.label)
      setStartDate(item.startDate)
      setEndDate(item.endDate)
      setColor(item.color)
      setProgress(item.progress ?? 0)
      setNotes(item.notes ?? '')
      setLaneIdSt(item.swimLaneId)
      setItemType(item.type)
      setTaskId(item.taskId ?? '')
      setSubItems(item.subItems ? [...item.subItems] : [])
      setPredIds(item.predecessorIds ?? [])
    } else {
      // New item defaults
      const today = new Date()
      const todayStr = formatDate(today)
      setLabel('')
      setStartDate(todayStr)
      setEndDate(formatDate(addDays(today, 14)))
      setColor(swimLanes.find(l => l.id === laneId)?.color ?? '#6366f1')
      setProgress(0)
      setNotes('')
      setLaneIdSt(laneId ?? swimLanes[0]?.id ?? '')
      setItemType('bar')
      setTaskId('')
      setSubItems([])
      setPredIds([])
    }
  }, [open, item, milestone])

  // When task is selected, auto-fill label from task name
  useEffect(() => {
    if (!taskId) return
    const linkedTask = allTasks.find(t => t.id === taskId)
    if (linkedTask && !label.trim()) setLabel(linkedTask.text)
  }, [taskId])

  function handleSaveItem() {
    if (!label.trim()) return
    const savedItem: TimelineItem = {
      id: item?.id ?? '',
      label: label.trim(),
      type: itemType,
      swimLaneId: laneIdSt,
      startDate,
      endDate: itemType === 'milestone' ? startDate : endDate,
      color,
      progress,
      notes: notes.trim() || undefined,
      taskId: taskId || undefined,
      subItems: subItems.length > 0 ? subItems : undefined,
      predecessorIds: predIds.length > 0 ? predIds : undefined,
    }
    onSaveItem(savedItem)

    // Sync dates + progress back to linked task so updateTask doesn't
    // overwrite the new timeline dates with the task's old due/startDate
    if (taskId) {
      const bucketEntry = taskBuckets.flatMap(b => b.tasks.map(t => ({ task: t, bucketId: b.id }))).find(x => x.task.id === taskId)
      if (bucketEntry) {
        updateTask(bucketEntry.bucketId, {
          ...bucketEntry.task,
          progress,
          startDate: startDate || bucketEntry.task.startDate,
          due: (itemType !== 'milestone' ? endDate : startDate) || bucketEntry.task.due,
        })
      }
    }
  }

  function handleSaveMilestone() {
    if (!msLabel.trim() || !milestone) return
    onSaveMilestone({ id: milestone.id, label: msLabel.trim(), date: msDate, color: msColor })
  }

  // ── Sub-item helpers ───────────────────────────────────────────────────────
  function addSubItem() {
    const today = new Date()
    setSubItems(prev => [...prev, {
      id: uid(),
      label: '',
      startDate: startDate || formatDate(today),
      endDate: endDate || formatDate(addDays(today, 7)),
      progress: 0,
    }])
  }

  function updateSubItem(id: string, patch: Partial<TimelineSubItem>) {
    setSubItems(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function removeSubItem(id: string) {
    setSubItems(prev => prev.filter(s => s.id !== id))
  }

  const isExisting = isMilestone ? !!(milestone && milestone.label !== 'Milestone') : !!(item && item.label !== 'New Item')

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

        {/* Drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">
            {isMilestone
              ? (milestone?.label === 'Milestone' ? 'New Milestone' : 'Edit Milestone')
              : (item?.label === 'New Item' ? 'New Item' : (item ? 'Edit Item' : 'New Item'))
            }
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-4">

          {isMilestone ? (
            /* ── Milestone form ─────────────────────────────────────── */
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Label</label>
                <input type="text" value={msLabel} onChange={e => setMsLabel(e.target.value)}
                  autoFocus placeholder="Milestone name"
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</label>
                <input type="date" value={msDate} onChange={e => setMsDate(e.target.value)}
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {MILESTONE_COLORS.map(c => (
                    <button key={c} type="button"
                      onClick={() => setMsColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${msColor === c ? 'border-slate-700 scale-110' : 'border-transparent'}`} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            /* ── Bar / item form ────────────────────────────────────── */
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Label</label>
                <input type="text" value={label} onChange={e => setLabel(e.target.value)}
                  autoFocus placeholder="Item label"
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Swim Lane</label>
                <select value={laneIdSt} onChange={e => setLaneIdSt(e.target.value)}
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white">
                  {swimLanes.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Start</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white" />
                </div>
                <div className="flex-1 flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">End</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    min={startDate}
                    className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px] bg-white" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {BAR_COLORS.map(c => (
                    <button key={c} type="button"
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? 'border-slate-700 scale-110' : 'border-transparent'}`} />
                  ))}
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    title="Custom color"
                    className="w-7 h-7 rounded-full border-2 border-slate-200 cursor-pointer p-0 overflow-hidden" />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Progress — {progress}%</label>
                <input type="range" min={0} max={100} value={progress}
                  onChange={e => setProgress(Number(e.target.value))}
                  className="w-full accent-blue-500" />
              </div>

              {/* Task auto-created on save — no manual link needed */}
              {taskId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-xl border border-indigo-100">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 7l3 3 8-7" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span className="text-xs text-indigo-600 font-medium">Linked to task in Tasks</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3} placeholder="Optional notes…"
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              {/* ── Predecessors ──────────────────────────────────────── */}
              {allItems.filter(i => i.id !== item?.id && i.type === 'bar').length > 0 && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Predecessors</label>
                  <p className="text-[11px] text-slate-400">Tasks that must finish before this one starts</p>
                  <div className="flex flex-col max-h-36 overflow-y-auto border border-slate-100 rounded-xl">
                    {allItems.filter(i => i.id !== item?.id && i.type === 'bar').map(i => (
                      <label key={i.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 cursor-pointer min-h-[40px]">
                        <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${predIds.includes(i.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                          {predIds.includes(i.id) && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-3.5" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>}
                        </span>
                        <input type="checkbox" className="sr-only" checked={predIds.includes(i.id)}
                          onChange={() => setPredIds(prev => prev.includes(i.id) ? prev.filter(x=>x!==i.id) : [...prev,i.id])} />
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: i.color }} />
                          <span className="text-xs text-slate-700 truncate">{i.label || '(untitled)'}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 flex-shrink-0">
                          {swimLanes.find(l=>l.id===i.swimLaneId)?.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Sub-items ─────────────────────────────────────────── */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sub-items</label>
                  <button type="button" onClick={addSubItem}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-500 hover:text-blue-700 transition-colors">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M5.5 1v9M1 5.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Add
                  </button>
                </div>
                {subItems.length === 0 && (
                  <p className="text-xs text-slate-400 italic">No sub-items yet. Click Add to create one.</p>
                )}
                {subItems.map((sub, idx) => (
                  <div key={sub.id} className="flex flex-col gap-2 bg-slate-50 rounded-xl p-3 relative">
                    <button type="button" onClick={() => removeSubItem(sub.id)}
                      className="absolute top-2 right-2 text-slate-300 hover:text-red-400 transition-colors p-1">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <div className="flex items-center gap-1.5 pr-6">
                      <span className="text-[10px] font-bold text-slate-400 flex-shrink-0">{idx + 1}.</span>
                      <input type="text" value={sub.label}
                        onChange={e => updateSubItem(sub.id, { label: e.target.value })}
                        placeholder="Sub-item label"
                        className="flex-1 px-2 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-[40px]" />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">Start</span>
                        <input type="date" value={sub.startDate}
                          onChange={e => updateSubItem(sub.id, { startDate: e.target.value })}
                          className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-[40px]" />
                      </div>
                      <div className="flex-1 flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">End</span>
                        <input type="date" value={sub.endDate} min={sub.startDate}
                          onChange={e => updateSubItem(sub.id, { endDate: e.target.value })}
                          className="w-full px-2 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white min-h-[40px]" />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase flex-shrink-0">Progress {sub.progress}%</span>
                      <input type="range" min={0} max={100} value={sub.progress}
                        onChange={e => updateSubItem(sub.id, { progress: Number(e.target.value) })}
                        className="flex-1 accent-blue-500" />
                      <label className="flex items-center gap-1 text-[10px] text-slate-500 flex-shrink-0 cursor-pointer">
                        <input type="checkbox" checked={!!sub.done}
                          onChange={e => updateSubItem(sub.id, { done: e.target.checked })}
                          className="accent-blue-500" />
                        Done
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="h-2" />
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-4 py-4 border-t border-slate-100 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {isExisting && (
            <button type="button"
              onClick={() => isMilestone && milestone
                ? onDeleteMilestone(milestone.id)
                : item && onDeleteItem(item.id)
              }
              className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 min-h-[48px] transition-colors">
              Delete
            </button>
          )}
          <button type="button"
            onClick={isMilestone ? handleSaveMilestone : handleSaveItem}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 min-h-[48px] transition-colors">
            {isExisting ? 'Save Changes' : (isMilestone ? 'Add Milestone' : 'Add Item')}
          </button>
        </div>
      </div>
    </>
  )
}
