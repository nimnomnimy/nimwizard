import { useRef, useState } from 'react'
import type { Timeline, TimelineItem, TimelineMilestone, TimelineSubItem, SwimLane } from '../../types'
import { uid } from '../../lib/utils'
import { addDays, formatDate } from './utils/dateLayout'

interface Props {
  timeline: Timeline
  onChange: (t: Timeline) => void
  onPatchItem?: (id: string, patch: Partial<TimelineItem>) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() { return formatDate(new Date()) }
function inWeek() { return formatDate(addDays(new Date(), 7)) }

// Inline editable cell — commits on blur or Enter
function EditableCell({
  value, placeholder, onCommit, className = '',
}: {
  value: string
  placeholder?: string
  onCommit: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  function start() { setDraft(value); setEditing(true); setTimeout(() => ref.current?.select(), 0) }
  function commit() { setEditing(false); if (draft !== value) onCommit(draft) }

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
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
      className={`border border-blue-400 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white ${className}`}
    />
  )
}

// Date cell — shows input[type=date] inline
function DateCell({ value, onCommit, className = '' }: { value: string; onCommit: (v: string) => void; className?: string }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => { if (e.target.value) onCommit(e.target.value) }}
      className={`border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-transparent cursor-pointer ${className}`}
    />
  )
}

// Progress pill
function ProgressCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 min-w-[60px]">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${value}%` }} />
      </div>
      <input
        type="number" min={0} max={100} value={value}
        onChange={e => { const v = Math.max(0, Math.min(100, Number(e.target.value))); onCommit(v) }}
        className="w-8 text-[10px] text-slate-500 text-right border border-transparent hover:border-slate-200 focus:border-blue-400 rounded focus:outline-none bg-transparent"
      />
      <span className="text-[10px] text-slate-400">%</span>
    </div>
  )
}

// Lane picker dropdown
function LanePicker({ value, lanes, onCommit }: { value: string; lanes: SwimLane[]; onCommit: (id: string) => void }) {
  const lane = lanes.find(l => l.id === value)
  return (
    <div className="flex items-center gap-1">
      {lane && <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: lane.color }} />}
      <select
        value={value}
        onChange={e => onCommit(e.target.value)}
        className="text-xs border border-transparent hover:border-slate-200 focus:border-blue-400 rounded px-1 py-0.5 bg-transparent focus:outline-none cursor-pointer max-w-[120px] text-slate-600"
      >
        {lanes.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TimelineTable({ timeline, onChange, onPatchItem }: Props) {
  const update = (patch: Partial<Timeline>) => onChange({ ...timeline, ...patch })

  // ── Milestone mutations ───────────────────────────────────────────────────
  function patchMilestone(id: string, patch: Partial<TimelineMilestone>) {
    update({ milestones: timeline.milestones.map(m => m.id === id ? { ...m, ...patch } : m) })
  }
  function addMilestone() {
    const m: TimelineMilestone = { id: uid(), label: 'Milestone', date: today(), color: '#ef4444' }
    update({ milestones: [...timeline.milestones, m] })
  }
  function deleteMilestone(id: string) {
    update({ milestones: timeline.milestones.filter(m => m.id !== id) })
  }

  // ── Item mutations ────────────────────────────────────────────────────────
  function patchItem(id: string, patch: Partial<TimelineItem>) {
    if (onPatchItem) {
      onPatchItem(id, patch)
    } else {
      update({ items: timeline.items.map(i => i.id === id ? { ...i, ...patch } : i) })
    }
  }
  function addItem(laneId: string) {
    const lane = timeline.swimLanes.find(l => l.id === laneId)
    const item: TimelineItem = {
      id: uid(), swimLaneId: laneId, label: '', type: 'bar',
      startDate: today(), endDate: inWeek(),
      color: lane?.color ?? '#6366f1', progress: 0,
    }
    update({ items: [...timeline.items, item] })
  }
  function deleteItem(id: string) {
    update({ items: timeline.items.filter(i => i.id !== id) })
  }

  // ── Sub-item mutations ────────────────────────────────────────────────────
  function patchSubItem(itemId: string, subId: string, patch: Partial<TimelineSubItem>) {
    update({
      items: timeline.items.map(i => i.id === itemId
        ? { ...i, subItems: (i.subItems ?? []).map(s => s.id === subId ? { ...s, ...patch } : s) }
        : i
      )
    })
  }
  function addSubItem(itemId: string) {
    const item = timeline.items.find(i => i.id === itemId)
    if (!item) return
    const sub: TimelineSubItem = {
      id: uid(), label: '', startDate: item.startDate, endDate: item.endDate, progress: 0,
    }
    update({
      items: timeline.items.map(i => i.id === itemId
        ? { ...i, subItems: [...(i.subItems ?? []), sub] }
        : i
      )
    })
  }
  function deleteSubItem(itemId: string, subId: string) {
    update({
      items: timeline.items.map(i => i.id === itemId
        ? { ...i, subItems: (i.subItems ?? []).filter(s => s.id !== subId) }
        : i
      )
    })
  }

  // Ordered rows: lanes in order, items in order per lane, then milestones at bottom
  const laneItems = (laneId: string) => timeline.items.filter(i => i.swimLaneId === laneId && i.type === 'bar')

  const COL_TH = 'text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-2 whitespace-nowrap'
  const CELL = 'px-2 py-1.5 text-xs text-slate-700 align-middle'

  return (
    <div className="border-t border-slate-200 bg-white">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-slate-400">
          <rect x="1" y="1" width="10" height="2" rx="0.5" fill="currentColor"/>
          <rect x="1" y="5" width="10" height="2" rx="0.5" fill="currentColor"/>
          <rect x="1" y="9" width="10" height="2" rx="0.5" fill="currentColor"/>
        </svg>
        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Table View</span>
        <span className="text-[10px] text-slate-400 ml-1">— click any cell to edit</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className={`${COL_TH} w-6`} />
              <th className={`${COL_TH} min-w-[180px]`}>Name</th>
              <th className={`${COL_TH} w-28`}>Lane</th>
              <th className={`${COL_TH} w-28`}>Start</th>
              <th className={`${COL_TH} w-28`}>End / Date</th>
              <th className={`${COL_TH} w-28`}>Progress</th>
              <th className={`${COL_TH} w-6`} />
            </tr>
          </thead>
          <tbody>

            {/* ── Lanes + items ─────────────────────────────────────────── */}
            {timeline.swimLanes.map(lane => {
              const items = laneItems(lane.id)
              return (
                <LaneSection
                  key={lane.id}
                  lane={lane}
                  items={items}
                  allLanes={timeline.swimLanes}
                  onPatchItem={patchItem}
                  onDeleteItem={deleteItem}
                  onAddItem={() => addItem(lane.id)}
                  onPatchSubItem={patchSubItem}
                  onAddSubItem={addSubItem}
                  onDeleteSubItem={deleteSubItem}
                  CELL={CELL}
                />
              )
            })}

            {/* ── Milestones ─────────────────────────────────────────────── */}
            {timeline.milestones.length > 0 && (
              <>
                <tr>
                  <td colSpan={7} className="px-2 pt-3 pb-1">
                    <div className="flex items-center gap-1.5">
                      <div className="h-px flex-1 bg-slate-100" />
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wide">Milestones</span>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>
                  </td>
                </tr>
                {timeline.milestones.map(m => (
                  <tr key={m.id} className="group border-b border-slate-50 hover:bg-amber-50/30 transition-colors">
                    {/* Type icon */}
                    <td className={CELL}>
                      <svg width="10" height="10" viewBox="0 0 14 14" fill={m.color} className="flex-shrink-0">
                        <path d="M7 0 L14 7 L7 14 L0 7 Z"/>
                      </svg>
                    </td>
                    {/* Label */}
                    <td className={`${CELL} font-medium`}>
                      <EditableCell value={m.label} placeholder="Milestone name"
                        onCommit={v => patchMilestone(m.id, { label: v })} />
                    </td>
                    {/* Lane — milestones are global */}
                    <td className={CELL}>
                      <span className="text-slate-300 text-xs italic">global</span>
                    </td>
                    {/* Date (start = end for milestones) */}
                    <td className={CELL}>
                      <DateCell value={m.date} onCommit={v => patchMilestone(m.id, { date: v })} />
                    </td>
                    {/* End (same as date) */}
                    <td className={CELL}>
                      <DateCell value={m.date} onCommit={v => patchMilestone(m.id, { date: v })} />
                    </td>
                    {/* Progress (N/A) */}
                    <td className={CELL} />
                    {/* Delete */}
                    <td className={CELL}>
                      <button
                        onClick={() => { if (confirm('Delete this milestone?')) deleteMilestone(m.id) }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-400 transition-all rounded"
                        title="Delete">
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M1 3h10M4.5 3V2h3v1M2.5 3l.8 7h5.4l.8-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </>
            )}

            {/* Add milestone row */}
            <tr className="border-b border-slate-50">
              <td colSpan={7} className="px-2 py-1">
                <button
                  onClick={addMilestone}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-500 hover:text-amber-600 hover:bg-amber-50 px-2 py-1 rounded transition-colors">
                  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                    <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Add milestone
                </button>
              </td>
            </tr>

          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Lane section ──────────────────────────────────────────────────────────────

interface LaneSectionProps {
  lane: SwimLane
  items: TimelineItem[]
  allLanes: SwimLane[]
  onPatchItem: (id: string, patch: Partial<TimelineItem>) => void
  onDeleteItem: (id: string) => void
  onAddItem: () => void
  onPatchSubItem: (itemId: string, subId: string, patch: Partial<TimelineSubItem>) => void
  onAddSubItem: (itemId: string) => void
  onDeleteSubItem: (itemId: string, subId: string) => void
  CELL: string
}

function LaneSection({
  lane, items, allLanes,
  onPatchItem, onDeleteItem, onAddItem,
  onPatchSubItem, onAddSubItem, onDeleteSubItem,
  CELL,
}: LaneSectionProps) {
  return (
    <>
      {/* Lane header row */}
      <tr>
        <td colSpan={7} className="px-2 pt-3 pb-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: lane.color }} />
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: lane.color }}>{lane.label}</span>
            <div className="h-px flex-1" style={{ backgroundColor: lane.color, opacity: 0.2 }} />
          </div>
        </td>
      </tr>

      {/* Item rows */}
      {items.map(item => (
        <ItemRow
          key={item.id}
          item={item}
          allLanes={allLanes}
          onPatch={patch => onPatchItem(item.id, patch)}
          onDelete={() => { if (confirm('Delete this task?')) onDeleteItem(item.id) }}
          onAddSubItem={() => onAddSubItem(item.id)}
          onPatchSubItem={(subId, patch) => onPatchSubItem(item.id, subId, patch)}
          onDeleteSubItem={subId => onDeleteSubItem(item.id, subId)}
          CELL={CELL}
        />
      ))}

      {/* Add item row */}
      <tr className="border-b border-slate-100">
        <td colSpan={7} className="px-2 py-1">
          <button
            onClick={onAddItem}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-blue-500 hover:bg-blue-50 px-2 py-1 rounded transition-colors">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Add task to {lane.label}
          </button>
        </td>
      </tr>
    </>
  )
}

// ── Item row ──────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: TimelineItem
  allLanes: SwimLane[]
  onPatch: (patch: Partial<TimelineItem>) => void
  onDelete: () => void
  onAddSubItem: () => void
  onPatchSubItem: (subId: string, patch: Partial<TimelineSubItem>) => void
  onDeleteSubItem: (subId: string) => void
  CELL: string
}

function ItemRow({
  item, allLanes, onPatch, onDelete, onAddSubItem, onPatchSubItem, onDeleteSubItem, CELL,
}: ItemRowProps) {
  const subItems = item.subItems ?? []

  return (
    <>
      <tr className="group border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
        {/* Bar icon */}
        <td className={`${CELL} text-center`}>
          <div className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: item.color }} />
        </td>
        {/* Label */}
        <td className={`${CELL} font-medium`}>
          <EditableCell value={item.label} placeholder="Task name"
            onCommit={v => onPatch({ label: v })}
            className="w-full" />
        </td>
        {/* Lane */}
        <td className={CELL}>
          <LanePicker value={item.swimLaneId} lanes={allLanes} onCommit={v => onPatch({ swimLaneId: v })} />
        </td>
        {/* Start */}
        <td className={CELL}>
          <DateCell value={item.startDate} onCommit={v => onPatch({ startDate: v })} />
        </td>
        {/* End */}
        <td className={CELL}>
          <DateCell value={item.endDate} onCommit={v => onPatch({ endDate: v })} />
        </td>
        {/* Progress */}
        <td className={CELL}>
          <ProgressCell value={item.progress} onCommit={v => onPatch({ progress: v })} />
        </td>
        {/* Actions */}
        <td className={`${CELL} whitespace-nowrap`}>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={onAddSubItem} title="Add subtask"
              className="p-1 text-slate-300 hover:text-blue-400 rounded transition-colors">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 1v6a1 1 0 001 1h5.5M9 7l1.5 1.5L9 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 4.5h3M8.5 3v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
            <button onClick={onDelete} title="Delete task"
              className="p-1 text-slate-300 hover:text-red-400 rounded transition-colors">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                <path d="M1 3h10M4.5 3V2h3v1M2.5 3l.8 7h5.4l.8-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {/* Sub-item rows */}
      {subItems.map((sub, si) => (
        <SubItemRow
          key={sub.id}
          sub={sub}
          parentColor={item.color}
          isLast={si === subItems.length - 1}
          onPatch={patch => onPatchSubItem(sub.id, patch)}
          onDelete={() => onDeleteSubItem(sub.id)}
          CELL={CELL}
        />
      ))}
    </>
  )
}

// ── Sub-item row ──────────────────────────────────────────────────────────────

interface SubItemRowProps {
  sub: TimelineSubItem
  parentColor: string
  isLast: boolean
  onPatch: (patch: Partial<TimelineSubItem>) => void
  onDelete: () => void
  CELL: string
}

function SubItemRow({ sub, parentColor, isLast, onPatch, onDelete, CELL }: SubItemRowProps) {
  return (
    <tr className="group border-b border-slate-50 hover:bg-indigo-50/20 transition-colors">
      {/* Indent + connector */}
      <td className={`${CELL} text-center`}>
        <div className="flex items-center justify-end pr-0.5">
          <svg width="14" height="16" viewBox="0 0 14 16" fill="none" className="text-slate-200">
            <path d={`M4 0 L4 ${isLast ? 10 : 16}`} stroke="currentColor" strokeWidth="1.5"/>
            <path d="M4 10 L11 10" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
        </div>
      </td>
      {/* Label */}
      <td className={`${CELL} pl-5`}>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-60" style={{ backgroundColor: parentColor }} />
          <EditableCell value={sub.label} placeholder="Subtask name" onCommit={v => onPatch({ label: v })} />
          {sub.done && <span className="text-[9px] text-emerald-500 font-bold flex-shrink-0">✓</span>}
        </div>
      </td>
      {/* Lane — inherited */}
      <td className={CELL}>
        <span className="text-slate-300 text-xs italic">inherited</span>
      </td>
      {/* Start */}
      <td className={CELL}>
        <DateCell value={sub.startDate} onCommit={v => onPatch({ startDate: v })} />
      </td>
      {/* End */}
      <td className={CELL}>
        <DateCell value={sub.endDate} onCommit={v => onPatch({ endDate: v })} />
      </td>
      {/* Progress */}
      <td className={CELL}>
        <ProgressCell value={sub.progress} onCommit={v => onPatch({ progress: v })} />
      </td>
      {/* Delete */}
      <td className={CELL}>
        <button onClick={onDelete} title="Delete subtask"
          className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-400 rounded transition-all">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M1 3h10M4.5 3V2h3v1M2.5 3l.8 7h5.4l.8-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </td>
    </tr>
  )
}
