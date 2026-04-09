import { useState, useEffect } from 'react'
import type { TimelineItem, TimelineMilestone, SwimLane, Timescale } from '../../types'
import { formatDate, addDays } from './utils/dateLayout'

const BAR_COLORS = [
  '#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#ec4899','#14b8a6','#f97316','#64748b',
]

const MILESTONE_COLORS = [
  '#ef4444','#f59e0b','#8b5cf6','#ec4899','#6366f1',
  '#3b82f6','#10b981','#14b8a6','#f97316',
]

interface Props {
  open: boolean
  item: TimelineItem | null
  milestone: TimelineMilestone | null
  laneId: string | null
  swimLanes: SwimLane[]
  timescale?: Timescale
  onSaveItem: (item: TimelineItem) => void
  onDeleteItem: (id: string) => void
  onSaveMilestone: (m: TimelineMilestone) => void
  onDeleteMilestone: (id: string) => void
  onClose: () => void
}

export default function ItemDrawer({
  open, item, milestone, laneId, swimLanes,
  onSaveItem, onDeleteItem, onSaveMilestone, onDeleteMilestone, onClose,
}: Props) {
  // ── Item form state ────────────────────────────────────────────────────────
  const [label,     setLabel]     = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [color,     setColor]     = useState('#6366f1')
  const [progress,  setProgress]  = useState(0)
  const [notes,     setNotes]     = useState('')
  const [laneIdSt,  setLaneIdSt]  = useState(laneId ?? swimLanes[0]?.id ?? '')
  const [itemType,  setItemType]  = useState<'bar' | 'milestone'>('bar')

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
    }
  }, [open, item, milestone])

  function handleSaveItem() {
    if (!label.trim()) return
    onSaveItem({
      id: item?.id ?? '',
      label: label.trim(),
      type: itemType,
      swimLaneId: laneIdSt,
      startDate,
      endDate: itemType === 'milestone' ? startDate : endDate,
      color,
      progress,
      notes: notes.trim() || undefined,
    })
  }

  function handleSaveMilestone() {
    if (!msLabel.trim() || !milestone) return
    onSaveMilestone({ id: milestone.id, label: msLabel.trim(), date: msDate, color: msColor })
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
      `} style={{ '--tw-w': '22rem' } as any}>

        {/* Drag handle */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">
            {isMilestone
              ? (milestone?.label === 'Milestone' ? 'New Milestone' : 'Edit Milestone')
              : (item?.label === 'New Item' ? 'New Item' : 'Edit Item')
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

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  rows={3} placeholder="Optional notes…"
                  className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
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
