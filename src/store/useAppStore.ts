import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  doc, setDoc, onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { AppState, Contact, Meeting, TaskBucket, SavedChart, DottedLine, PeerLine, Position, EmailSettings, Timeline, TimelineItem, SubTask } from '../types'

/** Recalculate a task's startDate/due from its subtasks' date spans. */
function subtaskDateSpan(subTasks: SubTask[]): { startDate?: string; due?: string } {
  const starts = subTasks.map(s => s.startDate).filter(Boolean) as string[]
  const ends   = subTasks.map(s => s.due).filter(Boolean) as string[]
  if (starts.length === 0 && ends.length === 0) return {}
  const allDates = [...starts, ...ends]
  return {
    startDate: starts.length > 0 ? starts.reduce((a, b) => a < b ? a : b) : allDates.reduce((a, b) => a < b ? a : b),
    due:       ends.length   > 0 ? ends.reduce((a, b) => a > b ? a : b)   : allDates.reduce((a, b) => a > b ? a : b),
  }
}

const DEFAULT_BUCKETS: TaskBucket[] = [
  { id: 'unsorted',   name: 'Unsorted',   color: '#a78bfa', tasks: [] },
  { id: 'backlog',    name: 'Backlog',     color: '#94a3b8', tasks: [] },
  { id: 'inprogress', name: 'In Progress', color: '#f59e0b', tasks: [] },
  { id: 'done',       name: 'Done',        color: '#10b981', tasks: [] },
]

interface StoreState extends AppState {
  uid: string | null
  loading: boolean
  syncing: boolean

  // Auth
  setUid: (uid: string | null) => void
  setLoading: (loading: boolean) => void

  // Data lifecycle
  loadUserData: (uid: string) => Promise<Unsubscribe>
  saveUserData: () => Promise<void>

  // Contacts
  addContact: (contact: Contact) => void
  updateContact: (contact: Contact) => void
  deleteContact: (id: string) => void

  // Org chart
  setPositions: (positions: Record<string, Position>) => void
  setChartContacts: (ids: string[]) => void
  setActiveChartOrg: (org: string | null) => void
  addDottedLine: (line: DottedLine) => void
  removeDottedLine: (fromId: string, toId: string) => void
  addPeerLine: (line: PeerLine) => void
  removePeerLine: (fromId: string, toId: string) => void
  saveChart: (chart: SavedChart) => void
  deleteChart: (id: string) => void

  // Meetings
  addMeeting: (meeting: Meeting) => void
  updateMeeting: (meeting: Meeting) => void
  deleteMeeting: (id: string) => void

  // Tasks
  setTaskBuckets: (buckets: TaskBucket[]) => void
  addTask: (bucketId: string, task: import('../types').Task) => void
  updateTask: (bucketId: string, task: import('../types').Task) => void
  moveTask: (taskId: string, fromBucketId: string, toBucketId: string) => void

  // Settings
  setEmailSettings: (settings: EmailSettings) => void

  // Timelines
  addTimeline: (t: Timeline) => void
  updateTimeline: (t: Timeline) => void
  deleteTimeline: (id: string) => void

  // Atomic cross-feature mutations (prevent concurrent-save races)

  /** Create a new task in a bucket AND add/update the linked timeline item in one write. */
  addTaskAndUpdateTimeline: (
    bucketId: string,
    task: import('../types').Task,
    timelineId: string,
    updatedItem: TimelineItem,
  ) => void

  /**
   * Save/update a task AND create-or-update its corresponding TimelineItem.
   * Used when a task is created/edited from TaskDrawer with a timeline assigned.
   */
  saveTaskWithTimelineItem: (
    bucketId: string,
    task: import('../types').Task,
  ) => void

  /**
   * Save/update a subtask on a parent task AND sync the matching TimelineSubItem
   * on the timeline bar that has taskId === parentTaskId.
   * If no matching bar exists nothing bad happens.
   */
  saveSubTaskWithTimelineSync: (
    bucketId: string,
    parentTaskId: string,
    sub: import('../types').SubTask,
    /** pass the id of the TimelineSubItem to update (equals sub.id by convention) */
    subItemId: string,
  ) => void

  /** Delete a subtask AND remove the matching sub-item from any timeline bar. */
  deleteSubTaskWithTimelineSync: (
    bucketId: string,
    parentTaskId: string,
    subId: string,
  ) => void

  /**
   * When an existing bar is saved from ItemDrawer, sync its full subItems list
   * to the linked task's subTasks in one atomic write.
   */
  syncBarSubItemsToTask: (updatedItem: TimelineItem) => void

  /** Load demo data into the account (merges on top of existing data). */
  loadDemoData: () => void

  /** Remove all demo data (contacts/meetings/tasks/timelines tagged as demo). */
  clearDemoData: () => void
}

// Tracks in-flight local writes so the onSnapshot doesn't overwrite fresh local state
let pendingWrites = 0

export const useAppStore = create<StoreState>()(
  immer((set, get) => ({
    uid: null,
    loading: true,
    syncing: false,

    contacts: [],
    meetings: [],
    dottedLines: [],
    peerLines: [],
    chartContacts: [],
    positions: {},
    activeChartOrg: null,
    taskBuckets: DEFAULT_BUCKETS,
    savedCharts: [],
    emailSettings: {},
    timelines: [],

    setUid: (uid) => set(s => { s.uid = uid }),
    setLoading: (loading) => set(s => { s.loading = loading }),

    loadUserData: async (uid) => {
      set(s => { s.loading = true })
      const userRef = doc(db, 'users', uid)
      const unsub = onSnapshot(userRef, (snap) => {
        // Suppress snapshots triggered by our own writes — they would overwrite
        // fresh local state with a slightly older Firestore copy
        if (pendingWrites > 0) return
        if (snap.exists()) {
          const d = snap.data() as Partial<AppState>
          set(s => {
            s.contacts      = d.contacts      ?? []
            s.meetings      = d.meetings      ?? []
            s.dottedLines   = d.dottedLines   ?? []
            s.peerLines     = d.peerLines     ?? []
            s.chartContacts = d.chartContacts ?? []
            s.positions     = d.positions     ?? {}
            s.activeChartOrg = d.activeChartOrg ?? null
            s.taskBuckets   = d.taskBuckets   ?? DEFAULT_BUCKETS
            s.savedCharts   = d.savedCharts   ?? []
            s.emailSettings = d.emailSettings ?? {}
            s.timelines     = d.timelines     ?? []
            s.loading = false
          })
        } else {
          // New user — initialise with empty defaults locally; don't write yet
          // (writing here caused data wipes on hot-reload / reconnect race conditions)
          set(s => { s.loading = false })
        }
      })
      return unsub
    },

    saveUserData: async () => {
      const { uid } = get()
      if (!uid) return
      pendingWrites++
      set(s => { s.syncing = true })
      const { contacts, meetings, dottedLines, peerLines, chartContacts,
              positions, activeChartOrg, taskBuckets, savedCharts, emailSettings, timelines } = get()
      try {
        await setDoc(doc(db, 'users', uid), {
          contacts, meetings, dottedLines, peerLines, chartContacts,
          positions, activeChartOrg, taskBuckets, savedCharts, emailSettings, timelines,
        })
      } finally {
        pendingWrites = Math.max(0, pendingWrites - 1)
        set(s => { s.syncing = false })
      }
    },

    addContact: (contact) => { set(s => { s.contacts.push(contact) }); get().saveUserData() },
    updateContact: (contact) => {
      set(s => { const i = s.contacts.findIndex(c => c.id === contact.id); if (i >= 0) s.contacts[i] = contact })
      get().saveUserData()
    },
    deleteContact: (id) => {
      set(s => {
        s.contacts = s.contacts.filter(c => c.id !== id)
        s.contacts.forEach(c => { if (c.parentId === id) c.parentId = '' })
        s.dottedLines = s.dottedLines.filter(d => d.fromId !== id && d.toId !== id)
        s.peerLines   = s.peerLines.filter(d => d.fromId !== id && d.toId !== id)
        s.chartContacts = s.chartContacts.filter(x => x !== id)
        delete s.positions[id]
      })
      get().saveUserData()
    },

    setPositions: (positions) => { set(s => { s.positions = positions }); get().saveUserData() },
    setChartContacts: (ids) => { set(s => { s.chartContacts = ids }); get().saveUserData() },
    setActiveChartOrg: (org) => { set(s => { s.activeChartOrg = org }); get().saveUserData() },
    addDottedLine: (line) => { set(s => { s.dottedLines.push(line) }); get().saveUserData() },
    removeDottedLine: (fromId, toId) => {
      set(s => { s.dottedLines = s.dottedLines.filter(d => !(d.fromId === fromId && d.toId === toId)) })
      get().saveUserData()
    },
    addPeerLine: (line) => { set(s => { s.peerLines.push(line) }); get().saveUserData() },
    removePeerLine: (fromId, toId) => {
      set(s => { s.peerLines = s.peerLines.filter(d => !(d.fromId === fromId && d.toId === toId)) })
      get().saveUserData()
    },
    saveChart: (chart) => { set(s => { s.savedCharts.push(chart) }); get().saveUserData() },
    deleteChart: (id) => { set(s => { s.savedCharts = s.savedCharts.filter(c => c.id !== id) }); get().saveUserData() },

    addMeeting: (meeting) => { set(s => { s.meetings.push(meeting) }); get().saveUserData() },
    updateMeeting: (meeting) => {
      set(s => { const i = s.meetings.findIndex(m => m.id === meeting.id); if (i >= 0) s.meetings[i] = meeting })
      get().saveUserData()
    },
    deleteMeeting: (id) => { set(s => { s.meetings = s.meetings.filter(m => m.id !== id) }); get().saveUserData() },

    setTaskBuckets: (buckets) => { set(s => { s.taskBuckets = buckets }); get().saveUserData() },

    addTask: (bucketId, task) => {
      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) bucket.tasks.push(task)
      })
      get().saveUserData()
    },

    updateTask: (bucketId, task) => {
      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) {
          const idx = bucket.tasks.findIndex(t => t.id === task.id)
          if (idx >= 0) bucket.tasks[idx] = task
        }
        // Sync label, dates, and progress to linked timeline items
        s.timelines.forEach(tl => {
          tl.items.forEach(item => {
            if (item.taskId === task.id) {
              item.label = task.text
              if (task.startDate) item.startDate = task.startDate
              if (task.due) item.endDate = task.due
              if (task.progress !== undefined) item.progress = task.progress ?? 0
            }
          })
        })
      })
      get().saveUserData()
    },

    moveTask: (taskId, fromBucketId, toBucketId) => {
      set(s => {
        const fromBucket = s.taskBuckets.find(b => b.id === fromBucketId)
        const toBucket   = s.taskBuckets.find(b => b.id === toBucketId)
        if (!fromBucket || !toBucket) return
        const taskIdx = fromBucket.tasks.findIndex(t => t.id === taskId)
        if (taskIdx < 0) return
        const [task] = fromBucket.tasks.splice(taskIdx, 1)
        toBucket.tasks.push(task)
      })
      get().saveUserData()
    },

    saveTaskWithTimelineItem: (bucketId, task) => {
      set(s => {
        // 1. Upsert the task in its bucket
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) {
          const idx = bucket.tasks.findIndex(t => t.id === task.id)
          if (idx >= 0) bucket.tasks[idx] = task
          else bucket.tasks.push(task)
        }

        // 2. If task has a timelineId, create or update the timeline bar
        if (task.timelineId) {
          const tl = s.timelines.find(x => x.id === task.timelineId)
          if (tl) {
            const existingItem = tl.items.find(i => i.taskId === task.id)
            const today = new Date().toISOString().split('T')[0]
            const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
            const laneId = task.swimLaneId ?? tl.swimLanes[0]?.id ?? ''
            if (existingItem) {
              // Update existing bar — sync label, dates
              existingItem.label = task.text
              if (task.startDate) existingItem.startDate = task.startDate
              if (task.due) existingItem.endDate = task.due
              if (task.progress !== undefined) existingItem.progress = task.progress ?? 0
              if (task.swimLaneId) existingItem.swimLaneId = task.swimLaneId
            } else {
              // Create new bar
              const lane = tl.swimLanes.find(l => l.id === laneId)
              tl.items.push({
                id: task.id + '_bar',  // stable, derived from taskId
                swimLaneId: laneId,
                label: task.text,
                type: 'bar',
                startDate: task.startDate ?? today,
                endDate: task.due ?? sevenDays,
                color: lane?.color ?? '#6366f1',
                progress: task.progress ?? 0,
                taskId: task.id,
              })
            }
          }
        } else {
          // timelineId cleared — sync label/progress to any existing linked bar
          s.timelines.forEach(tl => {
            tl.items.forEach(item => {
              if (item.taskId === task.id) {
                item.label = task.text
                if (task.startDate) item.startDate = task.startDate
                if (task.due) item.endDate = task.due
                if (task.progress !== undefined) item.progress = task.progress ?? 0
              }
            })
          })
        }
      })
      get().saveUserData()
    },

    setEmailSettings: (settings) => { set(s => { s.emailSettings = settings }); get().saveUserData() },

    addTimeline: (t) => { set(s => { s.timelines.push(t) }); get().saveUserData() },
    updateTimeline: (t) => {
      set(s => { const i = s.timelines.findIndex(x => x.id === t.id); if (i >= 0) s.timelines[i] = t })
      get().saveUserData()
    },
    deleteTimeline: (id) => { set(s => { s.timelines = s.timelines.filter(t => t.id !== id) }); get().saveUserData() },

    addTaskAndUpdateTimeline: (bucketId, task, timelineId, updatedItem) => {
      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) bucket.tasks.push(task)
        const tl = s.timelines.find(x => x.id === timelineId)
        if (tl) {
          const idx = tl.items.findIndex(i => i.id === updatedItem.id)
          if (idx >= 0) tl.items[idx] = updatedItem
          else tl.items.push(updatedItem)
        }
      })
      get().saveUserData()
    },

    saveSubTaskWithTimelineSync: (bucketId, parentTaskId, sub, subItemId) => {
      set(s => {
        // 1. Update the SubTask on the parent Task
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        const task = bucket?.tasks.find(t => t.id === parentTaskId)
        if (task) {
          if (!task.subTasks) task.subTasks = []
          const idx = task.subTasks.findIndex(st => st.id === sub.id)
          if (idx >= 0) task.subTasks[idx] = sub
          else task.subTasks.push(sub)

          // 2. Recalculate task's own date span from all subtasks
          const span = subtaskDateSpan(task.subTasks)
          if (span.startDate) task.startDate = span.startDate
          if (span.due)       task.due        = span.due
        }

        // 3. Find timeline bar linked to this task — sync sub-item AND bar dates
        for (const tl of s.timelines) {
          const item = tl.items.find(i => i.taskId === parentTaskId)
          if (item) {
            if (!item.subItems) item.subItems = []
            const siIdx = item.subItems.findIndex(si => si.id === subItemId)
            const subStart = sub.startDate ?? item.subItems[siIdx]?.startDate ?? item.startDate
            const subEnd   = sub.due       ?? item.subItems[siIdx]?.endDate   ?? item.endDate
            const newSubItem = {
              id: subItemId,
              label: sub.text,
              startDate: subStart,
              endDate: subEnd,
              progress: sub.progress ?? 0,
              done: sub.done,
              subTaskId: sub.id,
            }
            if (siIdx >= 0) item.subItems[siIdx] = newSubItem
            else item.subItems.push(newSubItem)

            // Expand bar to cover all sub-items
            const allStarts = item.subItems.map(si => si.startDate).filter(Boolean) as string[]
            const allEnds   = item.subItems.map(si => si.endDate).filter(Boolean) as string[]
            if (allStarts.length) item.startDate = allStarts.reduce((a, b) => a < b ? a : b)
            if (allEnds.length)   item.endDate   = allEnds.reduce((a, b) => a > b ? a : b)
            break
          }
        }
      })
      get().saveUserData()
    },

    deleteSubTaskWithTimelineSync: (bucketId, parentTaskId, subId) => {
      set(s => {
        // 1. Remove SubTask from task, then recalculate date span
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        const task = bucket?.tasks.find(t => t.id === parentTaskId)
        if (task) {
          task.subTasks = (task.subTasks ?? []).filter(st => st.id !== subId)
          const span = subtaskDateSpan(task.subTasks ?? [])
          if (span.startDate) task.startDate = span.startDate
          if (span.due)       task.due        = span.due
          // If no subtasks left, leave dates as-is (don't clear them)
        }

        // 2. Remove sub-item from timeline bar and contract bar dates
        for (const tl of s.timelines) {
          const item = tl.items.find(i => i.taskId === parentTaskId)
          if (item) {
            item.subItems = (item.subItems ?? []).filter(si => si.id !== subId && si.subTaskId !== subId)
            const allStarts = (item.subItems ?? []).map(si => si.startDate).filter(Boolean) as string[]
            const allEnds   = (item.subItems ?? []).map(si => si.endDate).filter(Boolean) as string[]
            if (allStarts.length) item.startDate = allStarts.reduce((a, b) => a < b ? a : b)
            if (allEnds.length)   item.endDate   = allEnds.reduce((a, b) => a > b ? a : b)
            break
          }
        }
      })
      get().saveUserData()
    },

    syncBarSubItemsToTask: (updatedItem) => {
      if (!updatedItem.taskId || !updatedItem.subItems?.length) return
      set(s => {
        // Find the bucket + task
        let foundBucketId: string | null = null
        let foundTask: import('../types').Task | null = null
        for (const bucket of s.taskBuckets) {
          const t = bucket.tasks.find(x => x.id === updatedItem.taskId)
          if (t) { foundBucketId = bucket.id; foundTask = t; break }
        }
        if (!foundTask || !foundBucketId) return

        const bucket = s.taskBuckets.find(b => b.id === foundBucketId)!
        const taskIdx = bucket.tasks.findIndex(t => t.id === updatedItem.taskId)
        const task = bucket.tasks[taskIdx]

        // Merge sub-items into task.subTasks (add new, update existing, keep orphans)
        if (!task.subTasks) task.subTasks = []
        for (const si of updatedItem.subItems ?? []) {
          const subId = si.subTaskId ?? si.id
          const existingIdx = task.subTasks.findIndex(st => st.id === subId)
          const asSub: import('../types').SubTask = {
            id: subId,
            text: si.label || 'Untitled',
            startDate: si.startDate || undefined,
            due: si.endDate || undefined,
            progress: si.progress,
            done: si.done,
          }
          if (existingIdx >= 0) task.subTasks[existingIdx] = { ...task.subTasks[existingIdx], ...asSub }
          else task.subTasks.push(asSub)
        }

        // Also update the timeline item itself
        for (const tl of s.timelines) {
          const itemIdx = tl.items.findIndex(i => i.id === updatedItem.id)
          if (itemIdx >= 0) {
            // Tag each sub-item with its matching subTaskId
            tl.items[itemIdx] = {
              ...updatedItem,
              subItems: (updatedItem.subItems ?? []).map(si => ({
                ...si,
                subTaskId: si.subTaskId ?? si.id,
              })),
            }
            break
          }
        }

        // Recalculate task date span from subtasks
        const span = subtaskDateSpan(task.subTasks)
        if (span.startDate) task.startDate = span.startDate
        if (span.due) task.due = span.due
      })
      get().saveUserData()
    },

    loadDemoData: () => {
      set(s => {
        // ── Contacts ──────────────────────────────────────────────────────────
        const c1 = 'demo-c1', c2 = 'demo-c2', c3 = 'demo-c3', c4 = 'demo-c4',
              c5 = 'demo-c5', c6 = 'demo-c6', c7 = 'demo-c7', c8 = 'demo-c8'
        const demoContacts: import('../types').Contact[] = [
          { id: c1, name: 'Sarah Chen',     title: 'Chief Executive Officer',       org: 'Acme Corp',   level: 'c-level',    email: 'sarah@acme.com',   createdAt: 1700000001000 },
          { id: c2, name: 'Marcus Webb',    title: 'VP Engineering',                org: 'Acme Corp',   level: 'gm',         email: 'marcus@acme.com',  createdAt: 1700000002000, parentId: c1 },
          { id: c3, name: 'Priya Nair',     title: 'VP Product',                    org: 'Acme Corp',   level: 'gm',         email: 'priya@acme.com',   createdAt: 1700000003000, parentId: c1 },
          { id: c4, name: 'Tom Okafor',     title: 'Engineering Manager',            org: 'Acme Corp',   level: 'manager',    email: 'tom@acme.com',     createdAt: 1700000004000, parentId: c2 },
          { id: c5, name: 'Lena Fischer',   title: 'Senior Software Engineer',       org: 'Acme Corp',   level: 'individual', email: 'lena@acme.com',    createdAt: 1700000005000, parentId: c4 },
          { id: c6, name: 'James Park',     title: 'Software Engineer',              org: 'Acme Corp',   level: 'individual', email: 'james@acme.com',   createdAt: 1700000006000, parentId: c4 },
          { id: c7, name: 'Aisha Mensah',   title: 'Head of Design',                org: 'Acme Corp',   level: 'head-of',    email: 'aisha@acme.com',   createdAt: 1700000007000, parentId: c3 },
          { id: c8, name: 'David Ruiz',     title: 'Product Manager',               org: 'Acme Corp',   level: 'manager',    email: 'david@acme.com',   createdAt: 1700000008000, parentId: c3 },
        ]
        for (const c of demoContacts) {
          if (!s.contacts.find(x => x.id === c.id)) s.contacts.push(c)
        }

        // ── Org chart ─────────────────────────────────────────────────────────
        for (const id of [c1, c2, c3, c4, c5, c6, c7, c8]) {
          if (!s.chartContacts.includes(id)) s.chartContacts.push(id)
        }
        const pos: Record<string, import('../types').Position> = {
          [c1]: { x: 400, y: 60 },  [c2]: { x: 200, y: 180 }, [c3]: { x: 600, y: 180 },
          [c4]: { x: 100, y: 300 }, [c5]: { x: 0,   y: 420 }, [c6]: { x: 200, y: 420 },
          [c7]: { x: 500, y: 300 }, [c8]: { x: 700, y: 300 },
        }
        for (const [id, p] of Object.entries(pos)) {
          if (!s.positions[id]) s.positions[id] = p
        }

        // ── Meetings ──────────────────────────────────────────────────────────
        const demoMeetings: import('../types').Meeting[] = [
          {
            id: 'demo-m1',
            title: 'Q2 Engineering Planning',
            date: '2026-04-14',
            attendees: [c1, c2, c4],
            discussion: 'Reviewed roadmap for Q2. Agreed to prioritise the new API gateway before mobile app work. Security audit to be scheduled.',
            actionItems: [
              { id: 'demo-ai1', text: 'Draft API gateway spec', done: false, assignee: c2, priority: 'high', due: '2026-04-18' },
              { id: 'demo-ai2', text: 'Schedule security audit', done: false, assignee: c4, priority: 'medium', due: '2026-04-21' },
              { id: 'demo-ai3', text: 'Update sprint board', done: true, assignee: c4, priority: 'low' },
            ],
            createdAt: 1700000010000,
          },
          {
            id: 'demo-m2',
            title: 'Product Design Review',
            date: '2026-04-16',
            attendees: [c3, c7, c8],
            discussion: 'Walked through new onboarding flow designs. Feedback: simplify step 3, add progress indicator, use existing component library colours.',
            actionItems: [
              { id: 'demo-ai4', text: 'Simplify onboarding step 3 designs', done: false, assignee: c7, priority: 'high', due: '2026-04-20' },
              { id: 'demo-ai5', text: 'Write acceptance criteria for onboarding', done: false, assignee: c8, priority: 'medium', due: '2026-04-22' },
            ],
            createdAt: 1700000020000,
          },
          {
            id: 'demo-m3',
            title: 'Weekly Standup',
            date: '2026-04-10',
            attendees: [c2, c4, c5, c6],
            discussion: 'Status: auth service refactor is 80% done. Lena blocked on test environment. James finishing PR review.',
            actionItems: [
              { id: 'demo-ai6', text: 'Unblock test environment for Lena', done: false, assignee: c4, priority: 'high', due: '2026-04-11' },
              { id: 'demo-ai7', text: 'Merge auth refactor PR', done: false, assignee: c5, priority: 'high', due: '2026-04-12' },
            ],
            createdAt: 1700000030000,
          },
        ]
        for (const m of demoMeetings) {
          if (!s.meetings.find(x => x.id === m.id)) s.meetings.push(m)
        }

        // ── Task buckets ──────────────────────────────────────────────────────
        const demoTasks: Record<string, import('../types').Task[]> = {
          backlog: [
            {
              id: 'demo-t1', text: 'Implement API gateway', priority: 'high',
              startDate: '2026-04-21', due: '2026-05-09',
              notes: 'Design-first approach. Covers auth, rate limiting, and routing.',
              progress: 0, createdAt: 1700000040000,
              subTasks: [
                { id: 'demo-st1', text: 'Write API spec', priority: 'high', startDate: '2026-04-21', due: '2026-04-25', progress: 0 },
                { id: 'demo-st2', text: 'Set up gateway infra', priority: 'medium', startDate: '2026-04-28', due: '2026-05-02', progress: 0 },
                { id: 'demo-st3', text: 'Implement auth middleware', priority: 'high', startDate: '2026-05-05', due: '2026-05-09', progress: 0 },
              ],
            },
            {
              id: 'demo-t2', text: 'Mobile app push notifications', priority: 'medium',
              startDate: '2026-05-12', due: '2026-05-23',
              progress: 0, createdAt: 1700000041000,
            },
          ],
          inprogress: [
            {
              id: 'demo-t3', text: 'Auth service refactor', priority: 'high',
              startDate: '2026-04-01', due: '2026-04-12',
              progress: 80, createdAt: 1700000042000,
              subTasks: [
                { id: 'demo-st4', text: 'Migrate to JWT tokens', priority: 'high', startDate: '2026-04-01', due: '2026-04-05', done: true, progress: 100 },
                { id: 'demo-st5', text: 'Update session handling', priority: 'medium', startDate: '2026-04-07', due: '2026-04-10', done: true, progress: 100 },
                { id: 'demo-st6', text: 'Write integration tests', priority: 'medium', startDate: '2026-04-11', due: '2026-04-12', progress: 40 },
              ],
            },
            {
              id: 'demo-t4', text: 'Onboarding flow redesign', priority: 'high',
              startDate: '2026-04-14', due: '2026-04-25',
              progress: 20, createdAt: 1700000043000,
              subTasks: [
                { id: 'demo-st7', text: 'Simplify step 3 UI', priority: 'high', startDate: '2026-04-14', due: '2026-04-18', progress: 30 },
                { id: 'demo-st8', text: 'Add progress indicator', priority: 'medium', startDate: '2026-04-21', due: '2026-04-25', progress: 0 },
              ],
            },
            {
              id: 'demo-t5', text: 'Analytics dashboard v2', priority: 'medium',
              startDate: '2026-04-07', due: '2026-04-18',
              progress: 50, createdAt: 1700000044000,
            },
          ],
          done: [
            {
              id: 'demo-t6', text: 'Set up CI/CD pipeline', priority: 'medium',
              startDate: '2026-03-17', due: '2026-03-28',
              progress: 100, createdAt: 1700000045000,
            },
            {
              id: 'demo-t7', text: 'Database schema migration', priority: 'high',
              startDate: '2026-03-24', due: '2026-04-04',
              progress: 100, createdAt: 1700000046000,
            },
          ],
        }
        for (const [bucketId, tasks] of Object.entries(demoTasks)) {
          const bucket = s.taskBuckets.find(b => b.id === bucketId)
          if (bucket) {
            for (const t of tasks) {
              if (!bucket.tasks.find(x => x.id === t.id)) bucket.tasks.push(t)
            }
          }
        }

        // ── Timeline ──────────────────────────────────────────────────────────
        if (!s.timelines.find(tl => tl.id === 'demo-tl1')) {
          const lane1 = 'demo-lane1', lane2 = 'demo-lane2', lane3 = 'demo-lane3'
          s.timelines.push({
            id: 'demo-tl1',
            name: 'Q2 2026 Roadmap',
            createdAt: 1700000050000,
            timescale: 'months',
            subTimescale: 'weeks',
            yearMode: 'calendar',
            startDate: '2026-04-01',
            endDate: '2026-06-30',
            labelWidth: 180,
            swimLanes: [
              { id: lane1, label: 'Engineering', color: '#6366f1' },
              { id: lane2, label: 'Product & Design', color: '#3b82f6' },
              { id: lane3, label: 'Infrastructure', color: '#10b981' },
            ],
            milestones: [
              { id: 'demo-ms1', label: 'API Gateway Launch', date: '2026-05-09', color: '#ef4444' },
              { id: 'demo-ms2', label: 'Q2 Review',          date: '2026-06-27', color: '#f59e0b' },
            ],
            items: [
              {
                id: 'demo-t3_bar',  swimLaneId: lane1, label: 'Auth service refactor',
                type: 'bar', startDate: '2026-04-01', endDate: '2026-04-12',
                color: '#6366f1', progress: 80, taskId: 'demo-t3',
                subItems: [
                  { id: 'demo-st4', label: 'Migrate to JWT tokens',  startDate: '2026-04-01', endDate: '2026-04-05', progress: 100, done: true,  subTaskId: 'demo-st4' },
                  { id: 'demo-st5', label: 'Update session handling', startDate: '2026-04-07', endDate: '2026-04-10', progress: 100, done: true,  subTaskId: 'demo-st5' },
                  { id: 'demo-st6', label: 'Write integration tests', startDate: '2026-04-11', endDate: '2026-04-12', progress: 40,  done: false, subTaskId: 'demo-st6' },
                ],
              },
              {
                id: 'demo-t1_bar', swimLaneId: lane1, label: 'API gateway implementation',
                type: 'bar', startDate: '2026-04-21', endDate: '2026-05-09',
                color: '#6366f1', progress: 0, taskId: 'demo-t1',
                subItems: [
                  { id: 'demo-st1', label: 'Write API spec',             startDate: '2026-04-21', endDate: '2026-04-25', progress: 0, subTaskId: 'demo-st1' },
                  { id: 'demo-st2', label: 'Set up gateway infra',       startDate: '2026-04-28', endDate: '2026-05-02', progress: 0, subTaskId: 'demo-st2' },
                  { id: 'demo-st3', label: 'Implement auth middleware',  startDate: '2026-05-05', endDate: '2026-05-09', progress: 0, subTaskId: 'demo-st3' },
                ],
              },
              {
                id: 'demo-t2_bar', swimLaneId: lane1, label: 'Push notifications',
                type: 'bar', startDate: '2026-05-12', endDate: '2026-05-23',
                color: '#8b5cf6', progress: 0, taskId: 'demo-t2',
              },
              {
                id: 'demo-t4_bar', swimLaneId: lane2, label: 'Onboarding redesign',
                type: 'bar', startDate: '2026-04-14', endDate: '2026-04-25',
                color: '#3b82f6', progress: 20, taskId: 'demo-t4',
                subItems: [
                  { id: 'demo-st7', label: 'Simplify step 3 UI',    startDate: '2026-04-14', endDate: '2026-04-18', progress: 30, subTaskId: 'demo-st7' },
                  { id: 'demo-st8', label: 'Add progress indicator', startDate: '2026-04-21', endDate: '2026-04-25', progress: 0,  subTaskId: 'demo-st8' },
                ],
              },
              {
                id: 'demo-t5_bar', swimLaneId: lane2, label: 'Analytics dashboard v2',
                type: 'bar', startDate: '2026-04-07', endDate: '2026-04-18',
                color: '#ec4899', progress: 50, taskId: 'demo-t5',
              },
              {
                id: 'demo-infra1', swimLaneId: lane3, label: 'Security audit',
                type: 'bar', startDate: '2026-04-22', endDate: '2026-05-06',
                color: '#10b981', progress: 0,
              },
              {
                id: 'demo-infra2', swimLaneId: lane3, label: 'Cloud cost review',
                type: 'bar', startDate: '2026-05-12', endDate: '2026-05-16',
                color: '#10b981', progress: 0,
              },
            ],
          })
        }
      })
      get().saveUserData()
    },

    clearDemoData: () => {
      set(s => {
        const demoContactIds = ['demo-c1','demo-c2','demo-c3','demo-c4','demo-c5','demo-c6','demo-c7','demo-c8']
        s.contacts    = s.contacts.filter(c => !c.id.startsWith('demo-'))
        s.dottedLines = s.dottedLines.filter(d => !demoContactIds.includes(d.fromId) && !demoContactIds.includes(d.toId))
        s.peerLines   = s.peerLines.filter(d => !demoContactIds.includes(d.fromId) && !demoContactIds.includes(d.toId))
        s.chartContacts = s.chartContacts.filter(id => !id.startsWith('demo-'))
        for (const id of demoContactIds) delete s.positions[id]
        s.meetings = s.meetings.filter(m => !m.id.startsWith('demo-'))
        for (const bucket of s.taskBuckets) {
          bucket.tasks = bucket.tasks.filter(t => !t.id.startsWith('demo-'))
        }
        s.timelines = s.timelines.filter(tl => !tl.id.startsWith('demo-'))
      })
      get().saveUserData()
    },
  }))
)
