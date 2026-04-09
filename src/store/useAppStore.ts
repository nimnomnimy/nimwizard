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
}

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
          setDoc(userRef, {
            contacts: [], meetings: [], dottedLines: [], peerLines: [],
            chartContacts: [], positions: {}, activeChartOrg: null,
            taskBuckets: DEFAULT_BUCKETS, savedCharts: [], emailSettings: {}, timelines: [],
          })
          set(s => { s.loading = false })
        }
      })
      return unsub
    },

    saveUserData: async () => {
      const { uid } = get()
      if (!uid) return
      set(s => { s.syncing = true })
      const { contacts, meetings, dottedLines, peerLines, chartContacts,
              positions, activeChartOrg, taskBuckets, savedCharts, emailSettings, timelines } = get()
      await setDoc(doc(db, 'users', uid), {
        contacts, meetings, dottedLines, peerLines, chartContacts,
        positions, activeChartOrg, taskBuckets, savedCharts, emailSettings, timelines,
      })
      set(s => { s.syncing = false })
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
  }))
)
