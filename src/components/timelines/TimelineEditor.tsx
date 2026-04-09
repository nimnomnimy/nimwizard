import { useRef, useState, useCallback, useEffect } from 'react'
import type { Timeline, TimelineItem, TimelineMilestone, SwimLane, Timescale, SubTimescale } from '../../types'
import { uid } from '../../lib/utils'
import {
  parseDate, formatDate, dateToPx, pxToDate, snapDate, getColumns,
  PX_PER_DAY, addDays,
} from './utils/dateLayout'
import ItemDrawer from './ItemDrawer'

// ─── Constants ────────────────────────────────────────────────────────────────
const LANE_HEIGHT   = 56   // px per swim lane row
const LABEL_WIDTH   = 140  // px for left lane label column
const RULER_H       = 36   // major ruler row height
const SUB_RULER_H   = 24   // minor ruler row height
const MILESTONE_R   = 7    // half-size of diamond
const MIN_BAR_W     = 4

// Sub-timescale options per timescale
const SUB_OPTIONS: Record<Timescale, Array<{ label: string; value: SubTimescale }>> = {
  days:     [{ label: 'None', value: null }],
  weeks:    [{ label: 'None', value: null }, { label: 'Days', value: 'days' }],
  months:   [{ label: 'None', value: null }, { label: 'Weeks', value: 'weeks' }],
  quarters: [{ label: 'None', value: null }, { label: 'Months', value: 'months' }, { label: 'Weeks', value: 'weeks' }],
  years:    [{ label: 'None', value: null }, { label: 'Quarters', value: 'quarters' }, { label: 'Months', value: 'months' }, { label: 'Weeks', value: 'weeks' }],
}

const TIMESCALE_LIST: Timescale[] = ['days', 'weeks', 'months', 'quarters', 'years']
const TIMESCALE_LABELS: Record<Timescale, string> = {
  days: 'Days', weeks: 'Weeks', months: 'Months', quarters: 'Quarters', years: 'Years',
}

const LANE_COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']

interface Props {
  timeline: Timeline
  onChange: (t: Timeline) => void
}

interface DragState {
  type: 'move' | 'resize-left' | 'resize-right'
  itemId: string
  startPx: number
  origStart: Date
  origEnd: Date
}

export default function TimelineEditor({ timeline, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const viewStart = parseDate(timeline.startDate)
  const viewEnd   = parseDate(timeline.endDate)
  const { major, minor } = getColumns(viewStart, viewEnd, timeline.timescale, timeline.subTimescale)
  const totalWidthPx = major.reduce((s, c) => s + c.widthPx, 0)
  const rulerTotal   = RULER_H + (minor ? SUB_RULER_H : 0)

  // ── Drawer state ──────────────────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<TimelineItem | null>(null)
  const [editingMilestone, setEditingMilestone] = useState<TimelineMilestone | null>(null)
  const [addingForLane, setAddingForLane] = useState<string | null>(null)

  // ── Drag state ────────────────────────────────────────────────────────────
  const dragRef = useRef<DragState | null>(null)

  // ── Today line ────────────────────────────────────────────────────────────
  const todayDate = new Date()
  const todayPx = dateToPx(todayDate, viewStart, timeline.timescale)

  // ── Helpers ───────────────────────────────────────────────────────────────
  const update = useCallback((patch: Partial<Timeline>) => {
    onChange({ ...timeline, ...patch })
  }, [timeline, onChange])

  function itemX(item: TimelineItem): number {
    return dateToPx(parseDate(item.startDate), viewStart, timeline.timescale)
  }
  function itemW(item: TimelineItem): number {
    const x1 = dateToPx(parseDate(item.startDate), viewStart, timeline.timescale)
    const x2 = dateToPx(parseDate(item.endDate), viewStart, timeline.timescale)
    return Math.max(x2 - x1, MIN_BAR_W)
  }
  function milestoneX(m: TimelineMilestone): number {
    return dateToPx(parseDate(m.date), viewStart, timeline.timescale)
  }

  // ── Pointer drag (bars) ───────────────────────────────────────────────────
  function startDrag(e: React.PointerEvent, item: TimelineItem, type: DragState['type']) {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      type,
      itemId: item.id,
      startPx: e.clientX,
      origStart: parseDate(item.startDate),
      origEnd: parseDate(item.endDate),
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startPx
    const pxPerDay = PX_PER_DAY[timeline.timescale]
    const daysDelta = Math.round(dx / pxPerDay)
    const items = timeline.items.map(it => {
      if (it.id !== drag.itemId) return it
      let newStart = drag.origStart
      let newEnd   = drag.origEnd
      if (drag.type === 'move') {
        newStart = snapDate(addDays(drag.origStart, daysDelta), timeline.timescale)
        newEnd   = addDays(drag.origEnd, daysDelta)
        const dur = Math.max(1, Math.round((drag.origEnd.getTime() - drag.origStart.getTime()) / 86_400_000))
        newEnd = addDays(newStart, dur)
      } else if (drag.type === 'resize-left') {
        newStart = snapDate(addDays(drag.origStart, daysDelta), timeline.timescale)
        if (newStart >= drag.origEnd) newStart = addDays(drag.origEnd, -1)
      } else {
        newEnd = snapDate(addDays(drag.origEnd, daysDelta), timeline.timescale)
        if (newEnd <= drag.origStart) newEnd = addDays(drag.origStart, 1)
      }
      return { ...it, startDate: formatDate(newStart), endDate: formatDate(newEnd) }
    })
    update({ items })
  }

  function onPointerUp() {
    dragRef.current = null
  }

  // ── Swim lane management ───────────────────────────────────────────────────
  function addLane() {
    const color = LANE_COLORS[timeline.swimLanes.length % LANE_COLORS.length]
    const lane: SwimLane = { id: uid(), label: `Lane ${timeline.swimLanes.length + 1}`, color }
    update({ swimLanes: [...timeline.swimLanes, lane] })
  }

  function renameLane(id: string, label: string) {
    update({ swimLanes: timeline.swimLanes.map(l => l.id === id ? { ...l, label } : l) })
  }

  function deleteLane(id: string) {
    if (!confirm('Delete this lane and all its items?')) return
    update({
      swimLanes: timeline.swimLanes.filter(l => l.id !== id),
      items: timeline.items.filter(i => i.swimLaneId !== id),
    })
  }

  function colorLane(id: string, color: string) {
    update({ swimLanes: timeline.swimLanes.map(l => l.id === id ? { ...l, color } : l) })
  }

  // ── Item / milestone save ──────────────────────────────────────────────────
  function saveItem(item: TimelineItem) {
    const exists = timeline.items.some(i => i.id === item.id)
    update({
      items: exists
        ? timeline.items.map(i => i.id === item.id ? item : i)
        : [...timeline.items, item],
    })
    setDrawerOpen(false)
    setEditingItem(null)
  }

  function deleteItem(id: string) {
    update({ items: timeline.items.filter(i => i.id !== id) })
    setDrawerOpen(false)
    setEditingItem(null)
  }

  function saveMilestone(m: TimelineMilestone) {
    const exists = timeline.milestones.some(x => x.id === m.id)
    update({
      milestones: exists
        ? timeline.milestones.map(x => x.id === m.id ? m : x)
        : [...timeline.milestones, m],
    })
    setDrawerOpen(false)
    setEditingMilestone(null)
  }

  function deleteMilestone(id: string) {
    update({ milestones: timeline.milestones.filter(m => m.id !== id) })
    setDrawerOpen(false)
    setEditingMilestone(null)
  }

  // ── Click on canvas (empty area) to add bar ────────────────────────────────
  function handleCanvasClick(e: React.MouseEvent, laneId: string) {
    if (dragRef.current) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0
    const clickX = e.clientX - rect.left + scrollLeft - LABEL_WIDTH
    const clickDate = pxToDate(clickX, viewStart, timeline.timescale)
    const endDate = addDays(snapDate(clickDate, timeline.timescale), 14)
    const lane = timeline.swimLanes.find(l => l.id === laneId)
    const newItem: TimelineItem = {
      id: uid(),
      swimLaneId: laneId,
      label: 'New Item',
      type: 'bar',
      startDate: formatDate(snapDate(clickDate, timeline.timescale)),
      endDate: formatDate(endDate),
      color: lane?.color ?? '#6366f1',
      progress: 0,
    }
    setEditingItem(newItem)
    setEditingMilestone(null)
    setAddingForLane(laneId)
    setDrawerOpen(true)
  }

  // ── Today scroll on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current && todayPx > 0) {
      const el = scrollRef.current
      const target = LABEL_WIDTH + todayPx - el.clientWidth / 2
      el.scrollLeft = Math.max(0, target)
    }
  }, [])

  const canvasH = timeline.swimLanes.length * LANE_HEIGHT

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0 flex-wrap">
        {/* Timescale */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          {TIMESCALE_LIST.map(s => (
            <button key={s} type="button"
              onClick={() => update({ timescale: s, subTimescale: null })}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                timeline.timescale === s
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              {TIMESCALE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Sub-timescale */}
        {SUB_OPTIONS[timeline.timescale].length > 1 && (
          <select
            value={timeline.subTimescale ?? ''}
            onChange={e => update({ subTimescale: (e.target.value || null) as SubTimescale })}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {SUB_OPTIONS[timeline.timescale].map(o => (
              <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>
            ))}
          </select>
        )}

        <div className="flex-1" />

        {/* Add milestone */}
        <button
          onClick={() => {
            setEditingMilestone({
              id: uid(), label: 'Milestone',
              date: formatDate(new Date()), color: '#ef4444',
            })
            setEditingItem(null)
            setAddingForLane(null)
            setDrawerOpen(true)
          }}
          className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg min-h-[32px] transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M5 0 L10 5 L5 10 L0 5 Z"/>
          </svg>
          Add Milestone
        </button>

        {/* Add lane */}
        <button
          onClick={addLane}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg min-h-[32px] transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Add Lane
        </button>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto scroll-touch select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div style={{ width: LABEL_WIDTH + totalWidthPx, minWidth: '100%' }}>

          {/* ── Ruler ─────────────────────────────────────────────────── */}
          <div className="sticky top-0 z-20 bg-white border-b border-slate-200 flex-shrink-0">
            {/* Corner */}
            <div className="flex">
              <div style={{ width: LABEL_WIDTH, height: RULER_H }} className="flex-shrink-0 border-r border-slate-200 bg-white" />
              {/* Major ticks */}
              <div className="flex relative" style={{ height: RULER_H }}>
                {major.map((col, i) => (
                  <div key={i}
                    style={{ width: col.widthPx, minWidth: col.widthPx }}
                    className="flex-shrink-0 border-r border-slate-100 flex items-center px-1.5 overflow-hidden">
                    <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">{col.label}</span>
                  </div>
                ))}
                {/* Today line on ruler */}
                {todayPx >= 0 && todayPx <= totalWidthPx && (
                  <div style={{ position: 'absolute', left: todayPx, top: 0, bottom: 0 }}
                    className="w-px bg-blue-400 pointer-events-none" />
                )}
              </div>
            </div>

            {/* Minor ticks */}
            {minor && (
              <div className="flex border-t border-slate-100">
                <div style={{ width: LABEL_WIDTH, height: SUB_RULER_H }} className="flex-shrink-0 border-r border-slate-200 bg-white" />
                <div className="flex">
                  {minor.map((col, i) => (
                    <div key={i}
                      style={{ width: col.widthPx, minWidth: col.widthPx }}
                      className="flex-shrink-0 border-r border-slate-100 flex items-center px-1 overflow-hidden"
                      >
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{col.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Swim lanes ────────────────────────────────────────────── */}
          <div style={{ position: 'relative', height: canvasH }}>

            {/* Today line (canvas) */}
            {todayPx >= 0 && todayPx <= totalWidthPx && (
              <div style={{
                position: 'absolute',
                left: LABEL_WIDTH + todayPx,
                top: 0, bottom: 0, width: 1,
                backgroundColor: '#60a5fa',
                opacity: 0.5,
                pointerEvents: 'none',
                zIndex: 5,
              }} />
            )}

            {/* Milestones (diamonds) */}
            {timeline.milestones.map(m => {
              const mx = LABEL_WIDTH + milestoneX(m)
              return (
                <div key={m.id}
                  style={{
                    position: 'absolute',
                    left: mx - MILESTONE_R,
                    top: rulerTotal - rulerTotal, // top of canvas
                    width: MILESTONE_R * 2,
                    height: canvasH,
                    zIndex: 10,
                    pointerEvents: 'none',
                  }}>
                  {/* Vertical line */}
                  <div style={{
                    position: 'absolute',
                    left: MILESTONE_R - 0.5,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    backgroundColor: m.color,
                    opacity: 0.4,
                  }} />
                  {/* Diamond */}
                  <button
                    style={{
                      position: 'absolute',
                      left: 0, top: 4,
                      width: MILESTONE_R * 2,
                      height: MILESTONE_R * 2,
                      pointerEvents: 'all',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setEditingMilestone(m)
                      setEditingItem(null)
                      setAddingForLane(null)
                      setDrawerOpen(true)
                    }}
                    title={m.label}
                  >
                    <svg width={MILESTONE_R * 2} height={MILESTONE_R * 2} viewBox="0 0 14 14">
                      <path d="M7 0 L14 7 L7 14 L0 7 Z" fill={m.color}/>
                    </svg>
                  </button>
                  {/* Label */}
                  <span style={{
                    position: 'absolute',
                    left: MILESTONE_R + 3,
                    top: 2,
                    fontSize: 10,
                    color: m.color,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                  }}>{m.label}</span>
                </div>
              )
            })}

            {timeline.swimLanes.map((lane, laneIdx) => {
              const laneY = laneIdx * LANE_HEIGHT
              const laneItems = timeline.items.filter(i => i.swimLaneId === lane.id)

              return (
                <div key={lane.id} style={{
                  position: 'absolute', top: laneY, left: 0,
                  width: LABEL_WIDTH + totalWidthPx, height: LANE_HEIGHT,
                  display: 'flex',
                }}>
                  {/* Lane label */}
                  <div style={{ width: LABEL_WIDTH, flexShrink: 0 }}
                    className="sticky left-0 z-10 bg-white border-r border-b border-slate-200 flex items-center px-2 gap-1 group">
                    {/* Color dot */}
                    <div className="relative">
                      <div
                        style={{ backgroundColor: lane.color }}
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer"
                        title="Change color"
                        onClick={() => {/* handled by hidden input below */}}
                      />
                      <input type="color" value={lane.color}
                        onChange={e => colorLane(lane.id, e.target.value)}
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        title="Lane color" />
                    </div>
                    <input
                      type="text"
                      value={lane.label}
                      onChange={e => renameLane(lane.id, e.target.value)}
                      className="flex-1 min-w-0 text-xs font-medium text-slate-700 bg-transparent focus:outline-none focus:bg-slate-50 rounded px-1"
                    />
                    {timeline.swimLanes.length > 1 && (
                      <button onClick={() => deleteLane(lane.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-300 hover:text-red-400 transition-all">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Lane canvas area */}
                  <div
                    style={{ flex: 1, position: 'relative', cursor: 'crosshair' }}
                    className="border-b border-slate-100 bg-white hover:bg-slate-50/30 transition-colors"
                    onClick={e => handleCanvasClick(e, lane.id)}
                  >
                    {/* Vertical grid lines */}
                    {major.map((_col, i) => {
                      const lineX = major.slice(0, i).reduce((s, c) => s + c.widthPx, 0)
                      return <div key={i} style={{
                        position: 'absolute', left: lineX, top: 0, bottom: 0, width: 1,
                        backgroundColor: '#f1f5f9', pointerEvents: 'none',
                      }} />
                    })}

                    {/* Bar items */}
                    {laneItems.filter(i => i.type === 'bar').map(item => {
                      const x = itemX(item)
                      const w = itemW(item)
                      const barY = (LANE_HEIGHT - 28) / 2
                      return (
                        <div key={item.id}
                          style={{
                            position: 'absolute',
                            left: x, top: barY,
                            width: w, height: 28,
                            borderRadius: 6,
                            backgroundColor: item.color,
                            opacity: 0.9,
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            overflow: 'hidden',
                            zIndex: 2,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                          }}
                          onPointerDown={e => startDrag(e, item, 'move')}
                          onClick={e => {
                            e.stopPropagation()
                            setEditingItem(item)
                            setEditingMilestone(null)
                            setAddingForLane(lane.id)
                            setDrawerOpen(true)
                          }}
                        >
                          {/* Resize left handle */}
                          <div
                            style={{ width: 8, height: '100%', cursor: 'ew-resize', flexShrink: 0 }}
                            className="hover:bg-black/10 transition-colors"
                            onPointerDown={e => { e.stopPropagation(); startDrag(e, item, 'resize-left') }}
                          />

                          {/* Progress fill */}
                          {item.progress > 0 && (
                            <div style={{
                              position: 'absolute', left: 0, top: 0, bottom: 0,
                              width: `${item.progress}%`,
                              backgroundColor: 'rgba(0,0,0,0.15)',
                              borderRadius: 6,
                              pointerEvents: 'none',
                            }} />
                          )}

                          {/* Label */}
                          <span style={{
                            flex: 1,
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'white',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            paddingLeft: 2,
                            paddingRight: 4,
                            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                            pointerEvents: 'none',
                          }}>{item.label}</span>

                          {/* Resize right handle */}
                          <div
                            style={{ width: 8, height: '100%', cursor: 'ew-resize', flexShrink: 0 }}
                            className="hover:bg-black/10 transition-colors"
                            onPointerDown={e => { e.stopPropagation(); startDrag(e, item, 'resize-right') }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Item / milestone drawer ──────────────────────────────────────── */}
      <ItemDrawer
        open={drawerOpen}
        item={editingItem}
        milestone={editingMilestone}
        laneId={addingForLane}
        swimLanes={timeline.swimLanes}
        timescale={timeline.timescale}
        onSaveItem={saveItem}
        onDeleteItem={deleteItem}
        onSaveMilestone={saveMilestone}
        onDeleteMilestone={deleteMilestone}
        onClose={() => {
          setDrawerOpen(false)
          setEditingItem(null)
          setEditingMilestone(null)
          setAddingForLane(null)
        }}
      />
    </div>
  )
}
