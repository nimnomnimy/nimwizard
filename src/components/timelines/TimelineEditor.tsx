import { useRef, useState, useCallback, useEffect } from 'react'
import type { Timeline, TimelineItem, TimelineMilestone, Timescale, SubTimescale, YearMode, TimelineSubItem, FreezePeriod } from '../../types'
import { uid } from '../../lib/utils'
import {
  parseDate, formatDate, dateToPx, pxToDate, snapDate, getColumns,
  PX_PER_DAY, addDays, getGroupLabel, getGroupKey,
} from './utils/dateLayout'
import ItemDrawer from './ItemDrawer'
import SubTaskDrawer from '../tasks/SubTaskDrawer'
import { useAppStore } from '../../store/useAppStore'

// ─── Constants ────────────────────────────────────────────────────────────────
const LANE_HEADER_H  = 36   // lane name row height
const BAR_ROW_H      = 40   // height of one task row
const SUB_ROW_H      = 32   // height of one sub-item row
const ADD_TASK_ROW_H = 28   // "+ Add task" button at bottom of label col
// Legacy alias kept for predecessor-line calculations
const LANE_HEIGHT    = LANE_HEADER_H
const DEFAULT_LABEL_W = 180
const MIN_LABEL_W    = 80
const MAX_LABEL_W    = 400
const RULER_H        = 36   // minor tick row height
const SUB_RULER_H    = 24   // sub-timescale row height (below major ticks)
const DBL_MAJOR_H    = 22   // top group row (always shown)
const DBL_MINOR_H    = 26   // major tick row (always shown below group row)
const MILESTONE_R    = 7
const MIN_BAR_W      = 4
const MIN_DRAW_PX    = 4

const SUB_OPTIONS: Record<Timescale, Array<{ label: string; value: SubTimescale }>> = {
  days:     [{ label: 'None', value: null }],
  weeks:    [{ label: 'None', value: null }, { label: 'Days', value: 'days' }],
  months:   [{ label: 'None', value: null }, { label: 'Weeks', value: 'weeks' }],
  quarters: [{ label: 'None', value: null }, { label: 'Months', value: 'months' }, { label: 'Weeks', value: 'weeks' }],
  years:    [{ label: 'None', value: null }, { label: 'Quarters', value: 'quarters' }, { label: 'Months', value: 'months' }, { label: 'Weeks', value: 'weeks' }],
}
const TIMESCALE_LIST: Timescale[] = ['days', 'weeks', 'months', 'quarters', 'years']
const TIMESCALE_LABELS: Record<Timescale, string> = { days:'Days', weeks:'Weeks', months:'Months', quarters:'Quarters', years:'Years' }
const LANE_COLORS = ['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']

interface Props { timeline: Timeline; onChange: (t: Timeline) => void }

interface BarDrag {
  kind: 'move' | 'resize-left' | 'resize-right'
  itemId: string; subId?: string
  origLaneId: string
  startClientX: number; startClientY: number; origStart: Date; origEnd: Date
}
interface DrawDrag {
  kind: 'draw'
  laneId: string
  anchorClientX: number; anchorDate: Date
}
interface LabelResize { kind: 'label-resize'; startClientX: number; startWidth: number }
type ActiveDrag = BarDrag | DrawDrag | LabelResize

interface Ghost { laneId: string; left: number; width: number; startDate: Date; endDate: Date }

// ── Current-period highlight bounds ──────────────────────────────────────────
function currentPeriodBounds(timescale: Timescale): { start: Date; end: Date } {
  const now = new Date()
  const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate()
  switch (timescale) {
    case 'days':     return { start: new Date(y,m,d), end: new Date(y,m,d+1) }
    case 'weeks': {
      const dow = now.getDay()
      const s = new Date(y,m,d-dow)
      return { start: s, end: addDays(s, 7) }
    }
    case 'months':   return { start: new Date(y,m,1), end: new Date(y,m+1,1) }
    case 'quarters': { const q=Math.floor(m/3); return { start: new Date(y,q*3,1), end: new Date(y,q*3+3,1) } }
    case 'years':    return { start: new Date(y,0,1), end: new Date(y+1,0,1) }
  }
}

export default function TimelineEditor({ timeline, onChange }: Props) {
  const scrollRef  = useRef<HTMLDivElement>(null)
  const canvasRef  = useRef<HTMLDivElement>(null)
  const dragRef    = useRef<ActiveDrag | null>(null)
  // Maps laneId → canvas-relative Y bounds (top inclusive, bottom exclusive)
  const laneBoundsRef = useRef<Map<string, { top: number; bottom: number }>>(new Map())

  const labelWidth = timeline.labelWidth ?? DEFAULT_LABEL_W

  const viewStart = parseDate(timeline.startDate)
  const viewEnd   = parseDate(timeline.endDate)
  const yearMode  = timeline.yearMode ?? 'calendar'
  const { major, minor } = getColumns(viewStart, viewEnd, timeline.timescale, timeline.subTimescale, yearMode)
  const totalWidthPx = major.reduce((s,c) => s + c.widthPx, 0)

  // ── Top-row groups: bucket adjacent major columns under a shared label ──────
  interface HeaderGroup { label: string; widthPx: number }
  const dblGroups: HeaderGroup[] = (() => {
    if (!major.length) return []
    const groups: HeaderGroup[] = []
    let curKey = ''; let curLabel = ''; let curWidth = 0
    for (const col of major) {
      const key   = getGroupKey(col.startDate, timeline.timescale, yearMode)
      const label = getGroupLabel(col.startDate, timeline.timescale, yearMode)
      if (key !== curKey) {
        if (curWidth > 0) groups.push({ label: curLabel, widthPx: curWidth })
        curKey = key; curLabel = label; curWidth = 0
      }
      curWidth += col.widthPx
    }
    if (curWidth > 0) groups.push({ label: curLabel, widthPx: curWidth })
    return groups
  })()

  // Task buckets for linking
  const taskBuckets = useAppStore(s => s.taskBuckets)
  const addTaskAndUpdateTimeline = useAppStore(s => s.addTaskAndUpdateTimeline)
  const saveSubTaskWithTimelineSync = useAppStore(s => s.saveSubTaskWithTimelineSync)
  const deleteSubTaskWithTimelineSync = useAppStore(s => s.deleteSubTaskWithTimelineSync)
  const syncBarSubItemsToTask = useAppStore(s => s.syncBarSubItemsToTask)
  const allTasks = taskBuckets.flatMap(b => b.tasks.map(t => ({ ...t, bucketName: b.name })))
  const allTasksFlat = taskBuckets.flatMap(b => b.tasks)

  // Freeze period drawer
  const [freezeDrawer, setFreezeDrawer] = useState<FreezePeriod | null>(null)

  const freezePeriods = timeline.freezePeriods ?? []

  function saveFreezeperiod(fp: FreezePeriod) {
    const exists = freezePeriods.some(f => f.id === fp.id)
    update({ freezePeriods: exists ? freezePeriods.map(f => f.id === fp.id ? fp : f) : [...freezePeriods, fp] })
    setFreezeDrawer(null)
  }
  function deleteFreezeperiod(id: string) {
    update({ freezePeriods: freezePeriods.filter(f => f.id !== id) })
    setFreezeDrawer(null)
  }
  function addFreezeperiod() {
    const today = new Date()
    setFreezeDrawer({
      id: uid(),
      label: 'Freeze',
      startDate: formatDate(today),
      endDate: formatDate(addDays(today, 14)),
      color: '#f59e0b',
    })
  }

  // Cross-lane drag target
  const [dragTargetLaneId, setDragTargetLaneId] = useState<string | null>(null)

  // Drawer
  const [drawerOpen,       setDrawerOpen]       = useState(false)
  const [editingItem,      setEditingItem]       = useState<TimelineItem | null>(null)
  const [editingMilestone, setEditingMilestone]  = useState<TimelineMilestone | null>(null)
  const [addingForLane,    setAddingForLane]     = useState<string | null>(null)

  // Sub-task drawer (for clicking a sub-item bar)
  interface SubDrawerState { item: TimelineItem; subItem: TimelineSubItem | null }
  const [subDrawer, setSubDrawer] = useState<SubDrawerState | null>(null)

  // Ghost + drag lock
  const [ghost,    setGhost]    = useState<Ghost | null>(null)
  const [dragging, setDragging] = useState(false)

  // Tap popover (bar vs milestone choice)
  interface TapPopover { x: number; y: number; laneId: string; date: Date }
  const [tapPopover, setTapPopover] = useState<TapPopover | null>(null)

  const todayDate = new Date()
  const todayPx   = dateToPx(todayDate, viewStart, timeline.timescale)
  const periodBounds = currentPeriodBounds(timeline.timescale)
  const periodX1 = dateToPx(periodBounds.start, viewStart, timeline.timescale)
  const periodX2 = dateToPx(periodBounds.end,   viewStart, timeline.timescale)

  const update = useCallback((patch: Partial<Timeline>) => { onChange({ ...timeline, ...patch }) }, [timeline, onChange])

  // ── Coordinate helpers ────────────────────────────────────────────────────
  function clientXToCanvasX(clientX: number) {
    // getBoundingClientRect().left already reflects current scroll position (visual coords),
    // so do NOT add scrollLeft — that would double-count horizontal scroll offset
    return clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0)
  }
  function canvasXToDate(canvasX: number) { return pxToDate(canvasX - labelWidth, viewStart, timeline.timescale) }
  function itemX(item: TimelineItem | TimelineSubItem) { return dateToPx(parseDate(item.startDate), viewStart, timeline.timescale) }
  function itemW(item: TimelineItem | TimelineSubItem) {
    return Math.max(dateToPx(parseDate(item.endDate), viewStart, timeline.timescale) - dateToPx(parseDate(item.startDate), viewStart, timeline.timescale), MIN_BAR_W)
  }

  // ── Bar drag ──────────────────────────────────────────────────────────────
  function startBarDrag(e: React.PointerEvent, item: TimelineItem | TimelineSubItem, kind: BarDrag['kind'], parentId?: string, laneId?: string) {
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = {
      kind, itemId: parentId ?? item.id, subId: parentId ? item.id : undefined,
      origLaneId: laneId ?? '',
      startClientX: e.clientX, startClientY: e.clientY,
      origStart: parseDate(item.startDate), origEnd: parseDate(item.endDate),
    }
    setDragging(true)
  }

  // ── Draw drag ─────────────────────────────────────────────────────────────
  function startDraw(e: React.PointerEvent, laneId: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(true)
    const canvasX = clientXToCanvasX(e.clientX)
    const anchorDate = snapDate(canvasXToDate(canvasX), timeline.timescale)
    dragRef.current = { kind: 'draw', laneId, anchorClientX: e.clientX, anchorDate }
    setGhost({ laneId, left: canvasX - labelWidth, width: 0, startDate: anchorDate, endDate: anchorDate })
  }

  // ── Label resize ──────────────────────────────────────────────────────────
  function startLabelResize(e: React.PointerEvent) {
    e.stopPropagation(); e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'label-resize', startClientX: e.clientX, startWidth: labelWidth }
    setDragging(true)
  }

  // ── Pointer move ──────────────────────────────────────────────────────────
  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return

    if (drag.kind === 'label-resize') {
      const newW = Math.min(MAX_LABEL_W, Math.max(MIN_LABEL_W, drag.startWidth + (e.clientX - drag.startClientX)))
      update({ labelWidth: Math.round(newW) })
      return
    }

    if (drag.kind === 'draw') {
      const canvasX = clientXToCanvasX(e.clientX)
      const curDate  = snapDate(canvasXToDate(canvasX), timeline.timescale)
      const anchorPx = dateToPx(drag.anchorDate, viewStart, timeline.timescale)
      const curPx    = dateToPx(curDate, viewStart, timeline.timescale)
      const left  = Math.min(anchorPx, curPx)
      const right = Math.max(anchorPx, curPx)
      setGhost({ laneId: drag.laneId, left, width: right - left,
        startDate: curPx < anchorPx ? curDate : drag.anchorDate,
        endDate:   curPx < anchorPx ? drag.anchorDate : curDate,
      })
      return
    }

    // Bar / sub drag
    const pxPerDay = PX_PER_DAY[timeline.timescale]
    const daysDelta = Math.round((e.clientX - drag.startClientX) / pxPerDay)

    // Cross-lane: detect which lane the pointer is over (only for 'move')
    if (drag.kind === 'move' && !drag.subId) {
      const canvasTop = canvasRef.current?.getBoundingClientRect().top ?? 0
      const scrollTop = scrollRef.current?.scrollTop ?? 0
      // canvasY relative to the scrollable content (not viewport)
      const rulerH = DBL_MAJOR_H + DBL_MINOR_H + (minor ? SUB_RULER_H : 0)
      const canvasY = e.clientY - canvasTop + scrollTop - rulerH
      let targetId: string | null = null
      for (const [lid, bounds] of laneBoundsRef.current) {
        if (canvasY >= bounds.top && canvasY < bounds.bottom) { targetId = lid; break }
      }
      setDragTargetLaneId(targetId)
    }

    if (drag.subId) {
      const items = timeline.items.map(it => {
        if (it.id !== drag.itemId) return it
        const subs = (it.subItems ?? []).map(s => {
          if (s.id !== drag.subId) return s
          let newStart = drag.origStart, newEnd = drag.origEnd
          if (drag.kind === 'move') {
            newStart = snapDate(addDays(drag.origStart, daysDelta), timeline.timescale)
            newEnd   = addDays(newStart, Math.max(1, Math.round((drag.origEnd.getTime()-drag.origStart.getTime())/86400000)))
          } else if (drag.kind === 'resize-left') {
            newStart = addDays(drag.origStart, daysDelta)
            if (newStart >= drag.origEnd) newStart = addDays(drag.origEnd,-1)
          } else {
            newEnd = addDays(drag.origEnd, daysDelta)
            if (newEnd <= drag.origStart) newEnd = addDays(drag.origStart,1)
          }
          return { ...s, startDate: formatDate(newStart), endDate: formatDate(newEnd) }
        })
        return { ...it, subItems: subs }
      })
      update({ items }); return
    }

    const items = timeline.items.map(it => {
      if (it.id !== drag.itemId) return it
      let newStart = drag.origStart, newEnd = drag.origEnd
      if (drag.kind === 'move') {
        newStart = snapDate(addDays(drag.origStart, daysDelta), timeline.timescale)
        newEnd   = addDays(newStart, Math.max(1, Math.round((drag.origEnd.getTime()-drag.origStart.getTime())/86400000)))
      } else if (drag.kind === 'resize-left') {
        newStart = addDays(drag.origStart, daysDelta)
        if (newStart >= drag.origEnd) newStart = addDays(drag.origEnd,-1)
      } else {
        newEnd = addDays(drag.origEnd, daysDelta)
        if (newEnd <= drag.origStart) newEnd = addDays(drag.origStart,1)
      }
      return { ...it, startDate: formatDate(newStart), endDate: formatDate(newEnd) }
    })
    update({ items })
  }

  // ── Pointer up ────────────────────────────────────────────────────────────
  function onPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    const finalTargetLaneId = dragTargetLaneId
    setDragTargetLaneId(null)

    if (drag?.kind === 'draw' && ghost) {
      setGhost(null)
      const drawPx = Math.abs(e.clientX - drag.anchorClientX)
      const lane = timeline.swimLanes.find(l => l.id === drag.laneId)

      if (drawPx < MIN_DRAW_PX) {
        // Short tap — show bar vs milestone popover
        const rect = scrollRef.current?.getBoundingClientRect()
        const scrollTop = scrollRef.current?.scrollTop ?? 0
        setTapPopover({
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0) + scrollTop,
          laneId: drag.laneId,
          date: drag.anchorDate,
        })
      } else {
        // Drawn a real range — open bar drawer directly
        const startDate = ghost.startDate
        const endDate   = ghost.endDate
        setEditingItem({ id: uid(), swimLaneId: drag.laneId, label: '', type: 'bar',
          startDate: formatDate(startDate), endDate: formatDate(endDate),
          color: lane?.color ?? '#6366f1', progress: 0 })
        setEditingMilestone(null); setAddingForLane(drag.laneId); setDrawerOpen(true)
      }
    } else {
      setGhost(null)
      // Cross-lane drop: reassign item to target lane
      if (drag?.kind === 'move' && !drag.subId && finalTargetLaneId && finalTargetLaneId !== drag.origLaneId) {
        update({
          items: timeline.items.map(it =>
            it.id === drag.itemId ? { ...it, swimLaneId: finalTargetLaneId } : it
          )
        })
      }
    }
  }

  // ── Tap popover handlers ──────────────────────────────────────────────────
  function tapChooseBar() {
    if (!tapPopover) return
    const lane = timeline.swimLanes.find(l => l.id === tapPopover.laneId)
    const startDate = tapPopover.date
    const endDate   = addDays(startDate, 7)
    setEditingItem({ id: uid(), swimLaneId: tapPopover.laneId, label: '', type: 'bar',
      startDate: formatDate(startDate), endDate: formatDate(endDate),
      color: lane?.color ?? '#6366f1', progress: 0 })
    setEditingMilestone(null); setAddingForLane(tapPopover.laneId)
    setTapPopover(null); setDrawerOpen(true)
  }

  function tapChooseMilestone() {
    if (!tapPopover) return
    setEditingMilestone({ id: uid(), label: 'Milestone', date: formatDate(tapPopover.date), color: '#ef4444' })
    setEditingItem(null); setAddingForLane(tapPopover.laneId)
    setTapPopover(null); setDrawerOpen(true)
  }

  // ── Lane management ───────────────────────────────────────────────────────
  function addLane() {
    const color = LANE_COLORS[timeline.swimLanes.length % LANE_COLORS.length]
    update({ swimLanes: [...timeline.swimLanes, { id: uid(), label: `Lane ${timeline.swimLanes.length+1}`, color }] })
  }
  function renameLane(id: string, label: string) { update({ swimLanes: timeline.swimLanes.map(l => l.id===id ? {...l,label} : l) }) }
  function deleteLane(id: string) {
    if (!confirm('Delete this lane and all its items?')) return
    update({ swimLanes: timeline.swimLanes.filter(l=>l.id!==id), items: timeline.items.filter(i=>i.swimLaneId!==id) })
  }
  function colorLane(id: string, color: string) { update({ swimLanes: timeline.swimLanes.map(l => l.id===id ? {...l,color} : l) }) }
  function toggleLane(id: string) { update({ swimLanes: timeline.swimLanes.map(l => l.id===id ? {...l, collapsed:!l.collapsed} : l) }) }

  // ── Item save/delete ──────────────────────────────────────────────────────
  function saveItem(item: TimelineItem) {
    const exists = timeline.items.some(i => i.id === item.id)
    let savedItem = item

    // Auto-create a Task when a new bar item with a label has no linked task yet
    if (!exists && item.type === 'bar' && item.label.trim() && !item.taskId) {
      const newTaskId = uid()
      const newTask: import('../../types').Task = {
        id: newTaskId,
        text: item.label.trim(),
        progress: item.progress || undefined,
        due: item.endDate || undefined,
        createdAt: Date.now(),
        timelineId: timeline.id,
      }
      savedItem = { ...item, taskId: newTaskId }
      // Atomic: add task + update timeline in one store write to avoid race
      addTaskAndUpdateTimeline('unsorted', newTask, timeline.id, savedItem)
      setDrawerOpen(false); setEditingItem(null)
      return
    }

    // If updating an existing bar linked to a task, sync sub-items to task's subTasks
    if (exists && savedItem.taskId && savedItem.subItems?.length) {
      syncBarSubItemsToTask(savedItem)
      setDrawerOpen(false); setEditingItem(null)
      return
    }

    update({ items: exists ? timeline.items.map(i => i.id === savedItem.id ? savedItem : i) : [...timeline.items, savedItem] })
    setDrawerOpen(false); setEditingItem(null)
  }

  // ── Add task button in lane header ────────────────────────────────────────
  function addTaskForLane(laneId: string) {
    const lane = timeline.swimLanes.find(l => l.id === laneId)
    const today = new Date()
    const newItem: TimelineItem = {
      id: uid(), swimLaneId: laneId, label: '', type: 'bar',
      startDate: formatDate(today), endDate: formatDate(addDays(today, 7)),
      color: lane?.color ?? '#6366f1', progress: 0,
    }
    setEditingItem(newItem); setEditingMilestone(null); setAddingForLane(laneId); setDrawerOpen(true)
  }

  // ── Sub-item save from sub-drawer ─────────────────────────────────────────
  function saveSubItemFromDrawer(sub: import('../../types').SubTask) {
    if (!subDrawer) return
    const { item } = subDrawer

    if (item.taskId) {
      // Atomic: saves SubTask on the parent Task AND syncs the TimelineSubItem — one write
      const bucketEntry = taskBuckets
        .flatMap(b => b.tasks.map(t => ({ task: t, bucketId: b.id })))
        .find(x => x.task.id === item.taskId)
      if (bucketEntry) {
        saveSubTaskWithTimelineSync(bucketEntry.bucketId, item.taskId, sub, sub.id)
        setSubDrawer(null)
        return
      }
    }

    // Bar not linked to a task yet — just update the timeline sub-item locally
    const { subItem } = subDrawer
    const asTimelineSub: TimelineSubItem = {
      id: subItem?.id ?? sub.id,
      label: sub.text,
      startDate: subItem?.startDate ?? item.startDate,
      endDate: subItem?.endDate ?? item.endDate,
      progress: sub.progress ?? 0,
      done: sub.done,
      subTaskId: sub.id,
    }
    const existingSi = (item.subItems ?? []).some(s => s.id === asTimelineSub.id)
    const newSubs = existingSi
      ? (item.subItems ?? []).map(s => s.id === asTimelineSub.id ? asTimelineSub : s)
      : [...(item.subItems ?? []), asTimelineSub]
    update({ items: timeline.items.map(i => i.id === item.id ? { ...i, subItems: newSubs } : i) })
    setSubDrawer(null)
  }

  function deleteSubItemFromDrawer(subId: string) {
    if (!subDrawer) return
    const { item } = subDrawer
    if (item.taskId) {
      const bucketEntry = taskBuckets
        .flatMap(b => b.tasks.map(t => ({ task: t, bucketId: b.id })))
        .find(x => x.task.id === item.taskId)
      if (bucketEntry) {
        deleteSubTaskWithTimelineSync(bucketEntry.bucketId, item.taskId, subId)
        setSubDrawer(null)
        return
      }
    }
    update({ items: timeline.items.map(i => i.id === item.id ? { ...i, subItems: (i.subItems ?? []).filter(s => s.id !== subId) } : i) })
    setSubDrawer(null)
  }
  function deleteItem(id: string) { update({ items: timeline.items.filter(i=>i.id!==id) }); setDrawerOpen(false); setEditingItem(null) }
  function saveMilestone(m: TimelineMilestone) {
    const exists = timeline.milestones.some(x=>x.id===m.id)
    update({ milestones: exists ? timeline.milestones.map(x=>x.id===m.id?m:x) : [...timeline.milestones, m] })
    setDrawerOpen(false); setEditingMilestone(null)
  }
  function deleteMilestone(id: string) { update({ milestones: timeline.milestones.filter(m=>m.id!==id) }); setDrawerOpen(false); setEditingMilestone(null) }

  // ── Scroll to today on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current && todayPx > 0) {
      scrollRef.current.scrollLeft = Math.max(0, labelWidth + todayPx - scrollRef.current.clientWidth / 2)
    }
  }, [])

  // ── Row layout helpers ────────────────────────────────────────────────────
  /** Total height of a lane including header, all task rows, sub-rows, add-task button */
  function laneH(laneId: string): number {
    const lane = timeline.swimLanes.find(l => l.id === laneId)
    if (lane?.collapsed) return LANE_HEADER_H + ADD_TASK_ROW_H
    const items = timeline.items.filter(i => i.swimLaneId === laneId && i.type === 'bar')
    const rowsHeight = items.reduce((sum, item) => {
      const subCount = item.collapsed ? 0 : (item.subItems?.length ?? 0)
      return sum + BAR_ROW_H + subCount * SUB_ROW_H
    }, 0)
    return LANE_HEADER_H + rowsHeight + ADD_TASK_ROW_H
  }

  /** Y offset (within the canvas area) of a task bar — below the header */
  function itemBarY(laneId: string, itemId: string): number {
    const items = timeline.items.filter(i => i.swimLaneId === laneId && i.type === 'bar')
    let y = LANE_HEADER_H
    for (const item of items) {
      if (item.id === itemId) return y + (BAR_ROW_H - 28) / 2
      const subCount = item.collapsed ? 0 : (item.subItems?.length ?? 0)
      y += BAR_ROW_H + subCount * SUB_ROW_H
    }
    return y + (BAR_ROW_H - 28) / 2
  }

  /** Y offset of a sub-item bar within the canvas */
  function subItemY(laneId: string, parentItemId: string, subIdx: number): number {
    const items = timeline.items.filter(i => i.swimLaneId === laneId && i.type === 'bar')
    let y = LANE_HEADER_H
    for (const item of items) {
      if (item.id === parentItemId) {
        return y + BAR_ROW_H + subIdx * SUB_ROW_H + (SUB_ROW_H - 24) / 2
      }
      const subCount = item.collapsed ? 0 : (item.subItems?.length ?? 0)
      y += BAR_ROW_H + subCount * SUB_ROW_H
    }
    return y
  }

  const totalCanvasH = timeline.swimLanes.reduce((s, l) => s + laneH(l.id), 0)

  // ── Lane Y offsets ────────────────────────────────────────────────────────
  function laneYOffset(laneIdx: number) {
    return timeline.swimLanes.slice(0, laneIdx).reduce((s, l) => s + laneH(l.id), 0)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative">

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 flex-shrink-0 flex-wrap gap-y-1">
        {/* Timescale */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {TIMESCALE_LIST.map(s => (
            <button key={s} type="button"
              onClick={() => update({ timescale: s, subTimescale: null })}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                timeline.timescale===s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {TIMESCALE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Sub-timescale */}
        {SUB_OPTIONS[timeline.timescale].length > 1 && (
          <select value={timeline.subTimescale ?? ''}
            onChange={e => update({ subTimescale: (e.target.value||null) as SubTimescale })}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400">
            {SUB_OPTIONS[timeline.timescale].map(o => (
              <option key={String(o.value)} value={o.value??''}>{o.label}</option>
            ))}
          </select>
        )}

        {/* Year mode (only relevant for quarters/years) */}
        {(timeline.timescale === 'quarters' || timeline.timescale === 'years') && (
          <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
            {(['calendar','financial'] as YearMode[]).map(m => (
              <button key={m} type="button"
                onClick={() => update({ yearMode: m })}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  yearMode===m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {m==='financial' ? 'FY' : 'CY'}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Freeze period */}
        <button
          onClick={addFreezeperiod}
          className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-lg min-h-[32px] transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 0v10M0 5h10M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          Freeze
        </button>

        <button
          onClick={() => { setEditingMilestone({id:uid(),label:'Milestone',date:formatDate(new Date()),color:'#ef4444'}); setEditingItem(null); setAddingForLane(null); setDrawerOpen(true) }}
          className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg min-h-[32px] transition-colors">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 0 L10 5 L5 10 L0 5 Z"/></svg>
          Milestone
        </button>
      </div>

      {/* ── Scrollable canvas ─────────────────────────────────────────────── */}
      <div ref={scrollRef}
        className="flex-1 overflow-auto scroll-touch select-none"
        style={{ touchAction: dragging ? 'none' : 'pan-x pan-y' }}
        onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <div ref={canvasRef} style={{ width: labelWidth + totalWidthPx, minWidth: '100%' }}>

          {/* ── Ruler (always double-row: group label above + major ticks below) ── */}
          <div className="sticky top-0 z-20 bg-white border-b border-slate-200">

            {/* Top row: period group labels */}
            <div className="flex border-b border-slate-100">
              <div style={{ width: labelWidth, height: DBL_MAJOR_H, flexShrink: 0 }}
                className="border-r border-slate-200 bg-slate-50 flex items-center px-3 relative">
                <div style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize', touchAction:'none' }}
                  className="hover:bg-blue-300/40 active:bg-blue-400/40 transition-colors"
                  onPointerDown={startLabelResize} />
              </div>
              <div className="flex relative overflow-hidden" style={{ height: DBL_MAJOR_H }}>
                {periodX1 < totalWidthPx && periodX2 > 0 && (
                  <div style={{ position:'absolute', left: Math.max(0,periodX1), top:0, bottom:0,
                    width: Math.min(totalWidthPx,periodX2)-Math.max(0,periodX1),
                    backgroundColor:'rgba(99,102,241,0.08)', pointerEvents:'none', zIndex:0 }} />
                )}
                {dblGroups.map((g,i) => (
                  <div key={i} style={{ width: g.widthPx, minWidth: g.widthPx }}
                    className="flex-shrink-0 border-r border-slate-200 flex items-center px-2 overflow-hidden bg-slate-50">
                    <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{g.label}</span>
                  </div>
                ))}
                {todayPx>=0 && todayPx<=totalWidthPx && (
                  <div style={{ position:'absolute', left:todayPx, top:0, bottom:0, width:2, backgroundColor:'#6366f1', pointerEvents:'none', zIndex:5 }} />
                )}
              </div>
            </div>

            {/* Middle row: major ticks */}
            <div className="flex">
              <div style={{ width: labelWidth, height: DBL_MINOR_H, flexShrink: 0 }}
                className="border-r border-slate-200 bg-slate-50 relative">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide absolute inset-0 flex items-center px-3">Lanes</span>
                <div style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize', touchAction:'none' }}
                  className="hover:bg-blue-300/40 active:bg-blue-400/40 transition-colors"
                  onPointerDown={startLabelResize} />
              </div>
              <div className="flex relative" style={{ height: DBL_MINOR_H }}>
                {periodX1 < totalWidthPx && periodX2 > 0 && (
                  <div style={{ position:'absolute', left: Math.max(0,periodX1), top:0, bottom:0,
                    width: Math.min(totalWidthPx,periodX2) - Math.max(0,periodX1),
                    backgroundColor:'rgba(99,102,241,0.08)', pointerEvents:'none', zIndex:0 }} />
                )}
                {major.map((col,i) => (
                  <div key={i} style={{ width:col.widthPx, minWidth:col.widthPx }}
                    className="flex-shrink-0 border-r border-slate-100 flex items-center px-1.5 overflow-hidden">
                    <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">{col.label}</span>
                  </div>
                ))}
                {todayPx>=0 && todayPx<=totalWidthPx && (
                  <div style={{ position:'absolute', left:todayPx, top:0, bottom:0, width:2, backgroundColor:'#6366f1', pointerEvents:'none', zIndex:5 }} />
                )}
              </div>
            </div>

            {/* Bottom row: minor ticks (optional sub-timescale) */}
            {minor && (
              <div className="flex border-t border-slate-100">
                <div style={{ width:labelWidth, height:SUB_RULER_H, flexShrink:0 }} className="border-r border-slate-200 bg-slate-50" />
                <div className="flex">
                  {minor.map((col,i) => (
                    <div key={i} style={{ width:col.widthPx, minWidth:col.widthPx }}
                      className="flex-shrink-0 border-r border-slate-100 flex items-center px-1 overflow-hidden">
                      <span className="text-[10px] text-slate-400 whitespace-nowrap">{col.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Swim lanes ──────────────────────────────────────────────── */}
          <div style={{ position:'relative', height: totalCanvasH }}>

            {/* ── Predecessor lines SVG ────────────────────────────────── */}
            <svg style={{ position:'absolute', left:0, top:0, width:'100%', height:totalCanvasH, pointerEvents:'none', zIndex:8, overflow:'visible' }}>
              {timeline.items.filter(item => item.predecessorIds?.length).flatMap(item =>
                (item.predecessorIds ?? []).map(predId => {
                  const pred = timeline.items.find(i => i.id === predId)
                  if (!pred) return null
                  const predLaneIdx = timeline.swimLanes.findIndex(l => l.id === pred.swimLaneId)
                  const itemLaneIdx = timeline.swimLanes.findIndex(l => l.id === item.swimLaneId)
                  if (predLaneIdx < 0 || itemLaneIdx < 0) return null
                  const predY = laneYOffset(predLaneIdx) + (LANE_HEIGHT - 28) / 2 + 14
                  const itemY = laneYOffset(itemLaneIdx) + (LANE_HEIGHT - 28) / 2 + 14
                  const x1 = labelWidth + dateToPx(parseDate(pred.endDate), viewStart, timeline.timescale)
                  const x2 = labelWidth + dateToPx(parseDate(item.startDate), viewStart, timeline.timescale)
                  const mx = x1 + Math.max(8, (x2 - x1) * 0.5)
                  return (
                    <g key={`${predId}->${item.id}`}>
                      <path d={`M ${x1} ${predY} C ${mx} ${predY} ${mx} ${itemY} ${x2} ${itemY}`}
                        stroke="#f59e0b" strokeWidth="1.5" fill="none" strokeDasharray="5,3"
                        markerEnd="url(#arrowhead)" />
                    </g>
                  )
                }).filter(Boolean)
              )}
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
                </marker>
              </defs>
            </svg>

            {/* Today line */}
            {todayPx>=0 && todayPx<=totalWidthPx && (
              <div style={{ position:'absolute', left:labelWidth+todayPx, top:0, bottom:0, width:2,
                backgroundColor:'#6366f1', opacity:0.4, pointerEvents:'none', zIndex:5 }} />
            )}

            {/* Current period band on canvas */}
            {periodX1 < totalWidthPx && periodX2 > 0 && (
              <div style={{ position:'absolute', left:labelWidth+Math.max(0,periodX1), top:0, bottom:0,
                width: Math.min(totalWidthPx,periodX2)-Math.max(0,periodX1),
                backgroundColor:'rgba(99,102,241,0.05)', pointerEvents:'none', zIndex:0 }} />
            )}

            {/* Freeze periods */}
            {freezePeriods.map(fp => {
              const fx1 = labelWidth + dateToPx(parseDate(fp.startDate), viewStart, timeline.timescale)
              const fx2 = labelWidth + dateToPx(parseDate(fp.endDate),   viewStart, timeline.timescale)
              if (fx2 <= labelWidth || fx1 >= labelWidth + totalWidthPx) return null
              const left  = Math.max(labelWidth, fx1)
              const right = Math.min(labelWidth + totalWidthPx, fx2)
              const width = right - left
              return (
                <div key={fp.id} style={{ position:'absolute', left, top:0, bottom:0, width, zIndex:3, pointerEvents:'none' }}>
                  {/* Colored semi-transparent band */}
                  <div style={{ position:'absolute', inset:0, backgroundColor: fp.color, opacity:0.12 }} />
                  {/* Left border */}
                  <div style={{ position:'absolute', left:0, top:0, bottom:0, width:2, backgroundColor:fp.color, opacity:0.5 }} />
                  {/* Right border */}
                  <div style={{ position:'absolute', right:0, top:0, bottom:0, width:2, backgroundColor:fp.color, opacity:0.5 }} />
                  {/* Label + click to edit */}
                  <button
                    style={{ position:'absolute', left:4, top:4, pointerEvents:'all', cursor:'pointer', background:'none', border:'none', padding:0 }}
                    onClick={() => setFreezeDrawer(fp)}>
                    <span style={{ fontSize:10, fontWeight:700, color:fp.color, whiteSpace:'nowrap', textShadow:'0 1px 2px rgba(255,255,255,0.9)' }}>{fp.label}</span>
                  </button>
                </div>
              )
            })}

            {/* Milestones */}
            {timeline.milestones.map(m => {
              const mx = labelWidth + dateToPx(parseDate(m.date), viewStart, timeline.timescale)
              return (
                <div key={m.id} style={{ position:'absolute', left:mx-MILESTONE_R, top:0, width:MILESTONE_R*2, height:totalCanvasH, zIndex:10, pointerEvents:'none' }}>
                  <div style={{ position:'absolute', left:MILESTONE_R-0.5, top:0, bottom:0, width:1, backgroundColor:m.color, opacity:0.35 }} />
                  <button style={{ position:'absolute', left:0, top:4, width:MILESTONE_R*2, height:MILESTONE_R*2, pointerEvents:'all', cursor:'pointer' }}
                    onClick={() => { setEditingMilestone(m); setEditingItem(null); setAddingForLane(null); setDrawerOpen(true) }}>
                    <svg width={MILESTONE_R*2} height={MILESTONE_R*2} viewBox="0 0 14 14"><path d="M7 0 L14 7 L7 14 L0 7 Z" fill={m.color}/></svg>
                  </button>
                  <span style={{ position:'absolute', left:MILESTONE_R+3, top:2, fontSize:9, color:m.color, fontWeight:700, whiteSpace:'nowrap', pointerEvents:'none' }}>{m.label}</span>
                </div>
              )
            })}

            {/* Lanes */}
            {timeline.swimLanes.map((lane, laneIdx) => {
              const laneY      = laneYOffset(laneIdx)
              const laneHeight = laneH(lane.id)
              const laneItems  = timeline.items.filter(i => i.swimLaneId===lane.id)
              const laneGhost  = ghost?.laneId===lane.id ? ghost : null
              const collapsed  = lane.collapsed
              const isDropTarget = dragTargetLaneId === lane.id

              // Register lane bounds for cross-lane hit detection
              laneBoundsRef.current.set(lane.id, { top: laneY, bottom: laneY + laneHeight })

              const barItems = laneItems.filter(i => i.type === 'bar')

              return (
                <div key={lane.id} style={{ position:'absolute', top:laneY, left:0, width:labelWidth+totalWidthPx, height:laneHeight, display:'flex' }}>

                  {/* ── Label column (sticky) ───────────────────────────── */}
                  <div style={{ width:labelWidth, flexShrink:0, height:laneHeight }}
                    className="sticky left-0 z-10 bg-white border-r border-b border-slate-200 flex flex-col relative group">

                    {/* Lane header row */}
                    <div className="flex items-center px-2 gap-1.5 flex-shrink-0 border-b border-slate-100" style={{ height: LANE_HEADER_H }}>
                      <button onClick={() => toggleLane(lane.id)}
                        className="text-slate-300 hover:text-slate-500 flex-shrink-0 transition-colors p-0.5">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition:'transform 0.15s' }}>
                          <path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
                        </svg>
                      </button>
                      <div className="relative flex-shrink-0">
                        <div style={{ backgroundColor:lane.color }} className="w-2.5 h-2.5 rounded-full" />
                        <input type="color" value={lane.color} onChange={e=>colorLane(lane.id,e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                      </div>
                      <input type="text" value={lane.label} onChange={e=>renameLane(lane.id,e.target.value)}
                        className="flex-1 min-w-0 text-xs font-semibold text-slate-700 bg-transparent focus:outline-none focus:bg-slate-50 rounded px-1 truncate" />
                      {timeline.swimLanes.length > 1 && (
                        <button onClick={()=>deleteLane(lane.id)} title="Delete lane"
                          className="lg:opacity-0 lg:group-hover:opacity-100 p-1 text-slate-300 hover:text-red-400 active:text-red-500 transition-all flex-shrink-0 min-w-[28px] min-h-[28px] flex items-center justify-center">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 3h10M4.5 3V2h3v1M2.5 3l.8 7h5.4l.8-7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      )}
                    </div>

                    {/* Per-task label rows */}
                    {!collapsed && barItems.map(item => {
                      const subItems = item.subItems ?? []
                      const itemCollapsed = item.collapsed
                      return (
                        <div key={item.id} className="flex flex-col flex-shrink-0 border-b border-slate-50">
                          {/* Task label row */}
                          <div className="group flex items-center gap-1.5 px-2" style={{ height: BAR_ROW_H }}>
                            {subItems.length > 0 ? (
                              <button onClick={e=>{ e.stopPropagation(); update({ items: timeline.items.map(i=>i.id===item.id?{...i,collapsed:!i.collapsed}:i) }) }}
                                className="text-slate-300 hover:text-slate-500 flex-shrink-0 transition-colors p-0.5">
                                <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"
                                  style={{ transform: itemCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition:'transform 0.15s' }}>
                                  <path d="M1.5 3l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
                                </svg>
                              </button>
                            ) : (
                              <div className="w-[13px] flex-shrink-0" />
                            )}
                            <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                            <span className="flex-1 text-xs font-medium text-slate-700 truncate leading-tight"
                              title={item.label}>{item.label || <span className="text-slate-300 italic">Untitled</span>}</span>
                            <button
                              onClick={e=>{ e.stopPropagation(); setSubDrawer({ item, subItem: null }) }}
                              title="Add subtask"
                              className="opacity-0 group-hover:opacity-100 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-all">
                              <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                          {/* Sub-item label rows */}
                          {!itemCollapsed && subItems.map(sub => (
                            <div key={sub.id} className="flex items-center gap-1.5 pl-6 pr-2 border-t border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors"
                              style={{ height: SUB_ROW_H }}
                              onClick={() => setSubDrawer({ item, subItem: sub })}>
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 opacity-60" style={{ backgroundColor: item.color }} />
                              <span className="flex-1 text-[11px] text-slate-500 truncate">{sub.label || <span className="text-slate-300 italic">Untitled</span>}</span>
                              {sub.done && <span className="text-[9px] text-emerald-500 font-bold flex-shrink-0">✓</span>}
                            </div>
                          ))}
                        </div>
                      )
                    })}

                    {/* Add task button */}
                    <button onClick={()=>addTaskForLane(lane.id)}
                      className="flex items-center gap-1.5 px-2 text-[10px] font-semibold text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 transition-colors w-full border-t border-slate-100 flex-shrink-0"
                      style={{ height: ADD_TASK_ROW_H }}>
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M4.5 1v7M1 4.5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      Add task
                    </button>

                    {/* Resize handle */}
                    <div style={{ position:'absolute', right:0, top:0, bottom:0, width:6, cursor:'col-resize', touchAction:'none' }}
                      className="hover:bg-blue-300/40 transition-colors"
                      onPointerDown={startLabelResize} />
                  </div>

                  {/* ── Canvas area ─────────────────────────────────────── */}
                  <div style={{ flex:1, position:'relative', cursor:'crosshair', touchAction:'none' }}
                    className={`border-b border-slate-100 transition-colors ${isDropTarget ? 'bg-blue-50' : 'bg-white'}`}
                    onPointerDown={e => {
                      // Auto-expand collapsed lane when user starts drawing
                      if (collapsed) toggleLane(lane.id)
                      startDraw(e, lane.id)
                    }}>

                    {/* Grid lines */}
                    {major.map((_,i) => {
                      const lx = major.slice(0,i).reduce((s,c)=>s+c.widthPx,0)
                      return <div key={i} style={{ position:'absolute', left:lx, top:0, bottom:0, width:1, backgroundColor:'#f1f5f9', pointerEvents:'none' }} />
                    })}

                    {/* Horizontal row dividers on canvas */}
                    {!collapsed && (() => {
                      const dividers: React.ReactNode[] = []
                      let y = LANE_HEADER_H
                      for (const item of barItems) {
                        y += BAR_ROW_H
                        dividers.push(<div key={item.id} style={{ position:'absolute', left:0, right:0, top:y-1, height:1, backgroundColor:'#f8fafc', pointerEvents:'none', zIndex:0 }} />)
                        if (!item.collapsed) {
                          for (let si = 0; si < (item.subItems?.length ?? 0); si++) {
                            y += SUB_ROW_H
                            dividers.push(<div key={item.id+'-s'+si} style={{ position:'absolute', left:0, right:0, top:y-1, height:1, backgroundColor:'#f1f5f9', pointerEvents:'none', zIndex:0 }} />)
                          }
                        }
                      }
                      return dividers
                    })()}

                    {!collapsed && (
                      <>
                        {/* Ghost bar while drawing */}
                        {laneGhost && laneGhost.width >= MIN_DRAW_PX && (
                          <div style={{ position:'absolute', left:laneGhost.left, top:LANE_HEADER_H + (BAR_ROW_H - 28)/2, width:laneGhost.width, height:28,
                            borderRadius:6, backgroundColor:lane.color, opacity:0.3, border:`2px solid ${lane.color}`, pointerEvents:'none', zIndex:1 }} />
                        )}

                        {/* Bar items — each on its own row */}
                        {barItems.map(item => {
                          const x = itemX(item); const w = itemW(item)
                          const subItems = item.subItems ?? []
                          const itemCollapsed = item.collapsed
                          const bY = itemBarY(lane.id, item.id)

                          return (
                            <div key={item.id}>
                              {/* Main bar */}
                              <div style={{ position:'absolute', left:x, top:bY, width:w, height:28,
                                borderRadius:6, backgroundColor:item.color, opacity:0.9,
                                cursor:'grab', display:'flex', alignItems:'center', overflow:'hidden', zIndex:2,
                                boxShadow:'0 1px 3px rgba(0,0,0,0.15)', touchAction:'none' }}
                                onPointerDown={e=>startBarDrag(e,item,'move',undefined,lane.id)}
                                onClick={e=>{ e.stopPropagation(); setEditingItem(item); setEditingMilestone(null); setAddingForLane(lane.id); setDrawerOpen(true) }}>
                                <div style={{ width:8, height:'100%', cursor:'ew-resize', flexShrink:0, touchAction:'none' }}
                                  className="hover:bg-black/10"
                                  onPointerDown={e=>{ e.stopPropagation(); startBarDrag(e,item,'resize-left',undefined,lane.id) }} />
                                {item.progress>0 && (
                                  <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${item.progress}%`,
                                    backgroundColor:'rgba(0,0,0,0.18)', borderRadius:6, pointerEvents:'none' }} />
                                )}
                                <span style={{ flex:1, fontSize:11, fontWeight:600, color:'white', whiteSpace:'nowrap',
                                  overflow:'hidden', textOverflow:'ellipsis', paddingLeft:2, paddingRight:4,
                                  textShadow:'0 1px 2px rgba(0,0,0,0.3)', pointerEvents:'none' }}>
                                  {item.label}
                                  {w > 80 && <span style={{ opacity:0.7, fontWeight:400, fontSize:9, marginLeft:4 }}>
                                    {item.startDate.slice(5)} – {item.endDate.slice(5)}
                                  </span>}
                                </span>
                                <div style={{ width:8, height:'100%', cursor:'ew-resize', flexShrink:0, touchAction:'none' }}
                                  className="hover:bg-black/10"
                                  onPointerDown={e=>{ e.stopPropagation(); startBarDrag(e,item,'resize-right',undefined,lane.id) }} />
                              </div>

                              {/* Sub-item bars — each on its own row */}
                              {!itemCollapsed && subItems.map((sub, si) => {
                                const sx = itemX(sub); const sw = itemW(sub)
                                const sY = subItemY(lane.id, item.id, si)
                                return (
                                  <div key={sub.id} style={{ position:'absolute', left:sx, top:sY, width:sw, height:24,
                                    borderRadius:4, backgroundColor: item.color, opacity:0.55,
                                    cursor:'grab', display:'flex', alignItems:'center', overflow:'hidden', zIndex:2,
                                    boxShadow:'0 1px 2px rgba(0,0,0,0.1)', touchAction:'none' }}
                                    onPointerDown={e=>startBarDrag(e,sub,'move',item.id)}
                                    onClick={e=>{ e.stopPropagation(); setSubDrawer({ item, subItem: sub }) }}>
                                    <div style={{ width:6, height:'100%', cursor:'ew-resize', flexShrink:0, touchAction:'none' }}
                                      onPointerDown={e=>{ e.stopPropagation(); startBarDrag(e,sub,'resize-left',item.id) }} />
                                    {sub.progress>0 && (
                                      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:`${sub.progress}%`,
                                        backgroundColor:'rgba(0,0,0,0.18)', borderRadius:4, pointerEvents:'none' }} />
                                    )}
                                    <span style={{ flex:1, fontSize:10, fontWeight:600, color:'white', whiteSpace:'nowrap',
                                      overflow:'hidden', textOverflow:'ellipsis', paddingLeft:2,
                                      textShadow:'0 1px 1px rgba(0,0,0,0.3)', pointerEvents:'none' }}>
                                      {sub.label}{sub.done && ' ✓'}
                                    </span>
                                    <div style={{ width:6, height:'100%', cursor:'ew-resize', flexShrink:0, touchAction:'none' }}
                                      onPointerDown={e=>{ e.stopPropagation(); startBarDrag(e,sub,'resize-right',item.id) }} />
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                </div>
              )
            })}

            {/* ── Add lane row at bottom ───────────────────────────────── */}
            <div style={{ position:'absolute', top:totalCanvasH, left:0, width:labelWidth+totalWidthPx, height:40, display:'flex' }}>
              <div style={{ width:labelWidth, flexShrink:0 }}
                className="sticky left-0 z-10 bg-slate-50 border-r border-t border-slate-200 flex items-center px-2">
                <button onClick={addLane}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-blue-500 transition-colors min-h-[32px]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Add Lane
                </button>
              </div>
              <div className="flex-1 border-t border-slate-100 bg-slate-50/50" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Tap popover: Bar vs Milestone ────────────────────────────────── */}
      {tapPopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setTapPopover(null)} />
          <div
            className="absolute z-50 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden"
            style={{ left: Math.min(tapPopover.x, (scrollRef.current?.clientWidth ?? 300) - 160), top: tapPopover.y + 8, width: 152 }}
          >
            <div className="px-3 py-2 border-b border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Add to timeline</p>
            </div>
            <button
              onClick={tapChooseBar}
              className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="w-7 h-4 rounded bg-indigo-500 flex-shrink-0" />
              <span className="text-sm font-semibold text-slate-700">Bar</span>
            </button>
            <button
              onClick={tapChooseMilestone}
              className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-slate-50 transition-colors border-t border-slate-50"
            >
              <svg width="16" height="16" viewBox="0 0 14 14" className="flex-shrink-0 text-amber-500" fill="currentColor">
                <path d="M7 0 L14 7 L7 14 L0 7 Z"/>
              </svg>
              <span className="text-sm font-semibold text-slate-700">Milestone</span>
            </button>
          </div>
        </>
      )}

      {/* ── Drawer ────────────────────────────────────────────────────────── */}
      <ItemDrawer
        open={drawerOpen}
        item={editingItem}
        milestone={editingMilestone}
        laneId={addingForLane}
        swimLanes={timeline.swimLanes}
        allTasks={allTasks}
        allItems={timeline.items}
        onSaveItem={saveItem}
        onDeleteItem={deleteItem}
        onSaveMilestone={saveMilestone}
        onDeleteMilestone={deleteMilestone}
        onClose={() => { setDrawerOpen(false); setEditingItem(null); setEditingMilestone(null); setAddingForLane(null) }}
      />

      {/* ── Sub-task drawer (click on sub-item bar) ───────────────────────── */}
      <SubTaskDrawer
        open={!!subDrawer}
        subTask={subDrawer?.subItem
          ? { id: subDrawer.subItem.id, text: subDrawer.subItem.label, progress: subDrawer.subItem.progress, done: subDrawer.subItem.done }
          : null}
        parentTask={subDrawer?.item.taskId ? (allTasksFlat.find(t => t.id === subDrawer?.item.taskId) ?? null) : null}
        allTasks={allTasksFlat}
        onSave={saveSubItemFromDrawer}
        onDelete={deleteSubItemFromDrawer}
        onClose={() => setSubDrawer(null)}
      />

      {/* ── Freeze Period Drawer ─────────────────────────────────────────── */}
      {freezeDrawer && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setFreezeDrawer(null)} />
          <div className="absolute right-4 top-16 z-50 bg-white rounded-2xl shadow-2xl border border-slate-100 w-72 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700">Freeze Period</p>
              <button onClick={() => setFreezeDrawer(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="px-4 py-4 flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Label</label>
                <input type="text" value={freezeDrawer.label}
                  onChange={e => setFreezeDrawer(p => p ? { ...p, label: e.target.value } : p)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400"
                  placeholder="e.g. Code Freeze" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Start</label>
                  <input type="date" value={freezeDrawer.startDate}
                    onChange={e => setFreezeDrawer(p => p ? { ...p, startDate: e.target.value } : p)}
                    className="w-full px-2 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">End</label>
                  <input type="date" value={freezeDrawer.endDate}
                    onChange={e => setFreezeDrawer(p => p ? { ...p, endDate: e.target.value } : p)}
                    className="w-full px-2 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Color</label>
                <div className="flex items-center gap-2">
                  {['#f59e0b','#ef4444','#8b5cf6','#3b82f6','#10b981','#ec4899'].map(c => (
                    <button key={c} type="button"
                      onClick={() => setFreezeDrawer(p => p ? { ...p, color: c } : p)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${freezeDrawer.color===c ? 'border-slate-800 scale-110' : 'border-transparent'}`} />
                  ))}
                  <input type="color" value={freezeDrawer.color}
                    onChange={e => setFreezeDrawer(p => p ? { ...p, color: e.target.value } : p)}
                    className="w-6 h-6 rounded cursor-pointer border border-slate-200" />
                </div>
              </div>
              {/* Preview swatch */}
              <div style={{ backgroundColor: freezeDrawer.color, opacity: 0.15, borderLeft:`3px solid ${freezeDrawer.color}` }}
                className="rounded-lg px-3 py-2">
                <span style={{ color: freezeDrawer.color }} className="text-xs font-bold">{freezeDrawer.label || 'Freeze Period'}</span>
              </div>
            </div>
            <div className="px-4 pb-4 flex gap-2">
              <button onClick={() => saveFreezeperiod(freezeDrawer)}
                className="flex-1 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors">
                Save
              </button>
              {freezePeriods.some(f => f.id === freezeDrawer.id) && (
                <button onClick={() => { if (confirm('Delete this freeze period?')) deleteFreezeperiod(freezeDrawer.id) }}
                  className="px-3 py-2 rounded-xl border border-red-200 text-red-500 hover:bg-red-50 text-sm transition-colors">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2h4v2M3 4l1 8h6l1-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
