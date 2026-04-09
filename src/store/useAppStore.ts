import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  doc, setDoc, deleteDoc, onSnapshot, collection,
  writeBatch, getDocs, getDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type {
  AppState, Contact, Meeting, TaskBucket, SavedChart, DottedLine,
  PeerLine, Position, EmailSettings, Timeline, TimelineItem, SubTask, Task,
} from '../types'
import { uid } from '../lib/utils'

// ─── Firestore path helpers ───────────────────────────────────────────────────
// Schema:
//   users/{uid}/contacts/{contactId}
//   users/{uid}/meetings/{meetingId}
//   users/{uid}/tasks/{taskId}          (includes bucketId field)
//   users/{uid}/timelines/{timelineId}
//   users/{uid}/settings/app            (buckets, org chart, email, saved charts)

const colRef  = (uid: string, sub: string) => collection(db, 'users', uid, sub)
const docRef  = (uid: string, sub: string, id: string) => doc(db, 'users', uid, sub, id)
const settingsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'app')

// ─── Default bucket definitions (no tasks — tasks live in their own docs) ─────
export const DEFAULT_BUCKET_DEFS: Omit<TaskBucket, 'tasks'>[] = [
  { id: 'unsorted',   name: 'Unsorted',   color: '#a78bfa' },
  { id: 'backlog',    name: 'Backlog',     color: '#94a3b8' },
  { id: 'inprogress', name: 'In Progress', color: '#f59e0b' },
  { id: 'done',       name: 'Done',        color: '#10b981' },
]

// ─── Settings document shape (stored at users/{uid}/settings/app) ─────────────
interface SettingsDoc {
  bucketDefs: Omit<TaskBucket, 'tasks'>[]
  dottedLines: DottedLine[]
  peerLines: PeerLine[]
  chartContacts: string[]
  positions: Record<string, Position>
  activeChartOrg: string | null
  savedCharts: SavedChart[]
  emailSettings: EmailSettings
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── In-memory loading state (not reactive, just coordination flags) ──────────
// These are module-level so they survive re-renders but reset on page reload
let collectionsLoaded = 0   // count of subcollections that have fired at least once
const TOTAL_COLLECTIONS = 4 // contacts, meetings, tasks, timelines (+settings fires separately)

// ─── Store interface ──────────────────────────────────────────────────────────
interface StoreState extends AppState {
  uid: string | null
  loading: boolean
  syncing: boolean

  setUid: (uid: string | null) => void
  setLoading: (loading: boolean) => void

  loadUserData: (uid: string) => Promise<Unsubscribe>
  saveUserData: () => void  // kept for compatibility; now a no-op (each action saves itself)

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
  saveMeetingWithTasks: (meeting: Meeting) => Meeting

  // Tasks
  setTaskBuckets: (buckets: TaskBucket[]) => void
  addTask: (bucketId: string, task: Task) => void
  updateTask: (bucketId: string, task: Task) => void
  moveTask: (taskId: string, fromBucketId: string, toBucketId: string) => void

  // Settings
  setEmailSettings: (settings: EmailSettings) => void

  // Timelines
  addTimeline: (t: Timeline) => void
  updateTimeline: (t: Timeline) => void
  deleteTimeline: (id: string) => void

  // Atomic cross-feature mutations
  addTaskAndUpdateTimeline: (bucketId: string, task: Task, timelineId: string, updatedItem: TimelineItem) => void
  saveTaskWithTimelineItem: (bucketId: string, task: Task) => void
  saveSubTaskWithTimelineSync: (bucketId: string, parentTaskId: string, sub: SubTask, subItemId: string) => void
  deleteSubTaskWithTimelineSync: (bucketId: string, parentTaskId: string, subId: string) => void
  syncBarSubItemsToTask: (updatedItem: TimelineItem) => void

  loadDemoData: () => void
  clearDemoData: () => void
}

// ─── Firestore write helpers ──────────────────────────────────────────────────
// Each helper fires a specific write and never touches unrelated data.

function writeContact(userUid: string, contact: Contact) {
  setDoc(docRef(userUid, 'contacts', contact.id), contact).catch(e =>
    console.error('[writeContact]', e))
}

function removeContact(userUid: string, id: string) {
  deleteDoc(docRef(userUid, 'contacts', id)).catch(e =>
    console.error('[removeContact]', e))
}

function writeMeeting(userUid: string, meeting: Meeting) {
  setDoc(docRef(userUid, 'meetings', meeting.id), meeting).catch(e =>
    console.error('[writeMeeting]', e))
}

function removeMeeting(userUid: string, id: string) {
  deleteDoc(docRef(userUid, 'meetings', id)).catch(e =>
    console.error('[removeMeeting]', e))
}

function writeTask(userUid: string, bucketId: string, task: Task) {
  setDoc(docRef(userUid, 'tasks', task.id), { ...task, bucketId }).catch(e =>
    console.error('[writeTask]', e))
}


function writeTimeline(userUid: string, timeline: Timeline) {
  setDoc(docRef(userUid, 'timelines', timeline.id), timeline).catch(e =>
    console.error('[writeTimeline]', e))
}

function removeTimeline(userUid: string, id: string) {
  deleteDoc(docRef(userUid, 'timelines', id)).catch(e =>
    console.error('[removeTimeline]', e))
}

function writeSettings(userUid: string, settings: SettingsDoc) {
  setDoc(settingsRef(userUid), settings).catch(e =>
    console.error('[writeSettings]', e))
}

// ─── Batch write helpers for cross-feature atomicity ─────────────────────────
async function batchWriteTaskAndTimeline(userUid: string, bucketId: string, task: Task, timeline: Timeline) {
  const batch = writeBatch(db)
  batch.set(docRef(userUid, 'tasks', task.id), { ...task, bucketId })
  batch.set(docRef(userUid, 'timelines', timeline.id), timeline)
  await batch.commit()
}

// ─── One-time migration: single doc → subcollections ────────────────────────
// If the user has an old monolithic doc at users/{uid}, fan it out into
// subcollections, then delete the old doc so migration never runs again.
async function migrateIfNeeded(userUid: string): Promise<boolean> {
  const legacyRef = doc(db, 'users', userUid)
  const legacySnap = await getDoc(legacyRef)
  if (!legacySnap.exists()) return false

  const data = legacySnap.data() as Partial<AppState>

  // Check if data already looks migrated (no top-level arrays = already done)
  // We detect migration by checking if subcollections exist
  const contactsSnap = await getDocs(colRef(userUid, 'contacts'))
  const tasksSnap    = await getDocs(colRef(userUid, 'tasks'))
  const alreadyMigrated = contactsSnap.size > 0 || tasksSnap.size > 0

  if (alreadyMigrated) {
    // Just delete the legacy doc if it's still there
    await deleteDoc(legacyRef)
    return false
  }

  console.log('[migration] Migrating legacy single-doc data to subcollections…')

  // Use batches (max 500 ops per batch)
  let batch = writeBatch(db)
  let opCount = 0

  const flush = async () => {
    if (opCount > 0) { await batch.commit(); batch = writeBatch(db); opCount = 0 }
  }
  const add = async (ref: Parameters<typeof batch.set>[0], data: object) => {
    batch.set(ref, data)
    opCount++
    if (opCount >= 490) await flush()
  }

  // Contacts
  for (const c of data.contacts ?? []) {
    await add(docRef(userUid, 'contacts', c.id), c)
  }

  // Meetings
  for (const m of data.meetings ?? []) {
    await add(docRef(userUid, 'meetings', m.id), m)
  }

  // Tasks (flattened from buckets)
  for (const bucket of data.taskBuckets ?? []) {
    for (const task of bucket.tasks) {
      await add(docRef(userUid, 'tasks', task.id), { ...task, bucketId: bucket.id })
    }
  }

  // Timelines
  for (const tl of data.timelines ?? []) {
    await add(docRef(userUid, 'timelines', tl.id), tl)
  }

  // Settings
  const bucketDefs: Omit<TaskBucket, 'tasks'>[] = (data.taskBuckets ?? []).map(
    ({ id, name, color }) => ({ id, name, color })
  )
  const settings: SettingsDoc = {
    bucketDefs: bucketDefs.length > 0 ? bucketDefs : DEFAULT_BUCKET_DEFS,
    dottedLines:    data.dottedLines    ?? [],
    peerLines:      data.peerLines      ?? [],
    chartContacts:  data.chartContacts  ?? [],
    positions:      data.positions      ?? {},
    activeChartOrg: data.activeChartOrg ?? null,
    savedCharts:    data.savedCharts    ?? [],
    emailSettings:  data.emailSettings  ?? {},
  }
  await add(settingsRef(userUid), settings)

  await flush()

  // Delete legacy doc
  await deleteDoc(legacyRef)
  console.log('[migration] Done. Legacy doc deleted.')
  return true
}

// ─── Store ────────────────────────────────────────────────────────────────────
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
    taskBuckets: DEFAULT_BUCKET_DEFS.map(d => ({ ...d, tasks: [] })),
    savedCharts: [],
    emailSettings: {},
    timelines: [],

    setUid: (uid) => {
      collectionsLoaded = 0
      set(s => { s.uid = uid })
    },
    setLoading: (loading) => set(s => { s.loading = loading }),

    // saveUserData is a no-op now — each action writes its own docs.
    // Kept so any component that calls it doesn't break.
    saveUserData: () => {},

    loadUserData: async (userUid) => {
      set(s => { s.loading = true })
      collectionsLoaded = 0

      // Run migration from old single-doc format first
      try {
        await migrateIfNeeded(userUid)
      } catch (e) {
        console.warn('[migration] failed (non-fatal):', e)
      }

      const unsubs: Unsubscribe[] = []

      // Track how many subcollections have fired their first snapshot
      const markLoaded = () => {
        collectionsLoaded++
        // Once all 4 subcollections + settings have reported in, clear loading
        if (collectionsLoaded >= TOTAL_COLLECTIONS + 1) {
          set(s => { s.loading = false })
        }
      }

      // ── Contacts ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'contacts'), (snap) => {
        const contacts: Contact[] = snap.docs.map(d => d.data() as Contact)
        set(s => { s.contacts = contacts })
        markLoaded()
      }, (e) => { console.error('[contacts snapshot]', e); markLoaded() }))

      // ── Meetings ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'meetings'), (snap) => {
        const meetings: Meeting[] = snap.docs.map(d => d.data() as Meeting)
        set(s => { s.meetings = meetings })
        markLoaded()
      }, (e) => { console.error('[meetings snapshot]', e); markLoaded() }))

      // ── Tasks ───────────────────────────────────────────────────────────────
      // We store the raw flat task list and rebuild taskBuckets whenever either
      // tasks or settings (bucket defs) update — ensuring correct assignment
      // regardless of which snapshot fires first.
      let rawTasks: Array<Task & { bucketId: string }> = []

      const rebuildTaskBuckets = () => {
        set(s => {
          const taskMap: Record<string, Task[]> = {}
          for (const b of s.taskBuckets) taskMap[b.id] = []
          for (const { bucketId, ...task } of rawTasks) {
            if (!taskMap[bucketId]) taskMap[bucketId] = []
            taskMap[bucketId].push(task)
          }
          for (const b of s.taskBuckets) {
            b.tasks = taskMap[b.id] ?? []
          }
        })
      }

      unsubs.push(onSnapshot(colRef(userUid, 'tasks'), (snap) => {
        rawTasks = snap.docs.map(d => d.data() as Task & { bucketId: string })
        rebuildTaskBuckets()
        markLoaded()
      }, (e) => { console.error('[tasks snapshot]', e); markLoaded() }))

      // ── Timelines ───────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'timelines'), (snap) => {
        const timelines: Timeline[] = snap.docs.map(d => d.data() as Timeline)
        set(s => { s.timelines = timelines })
        markLoaded()
      }, (e) => { console.error('[timelines snapshot]', e); markLoaded() }))

      // ── Settings ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(settingsRef(userUid), (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<SettingsDoc>
          set(s => {
            if (d.bucketDefs && d.bucketDefs.length > 0) {
              s.taskBuckets = d.bucketDefs.map(def => ({ ...def, tasks: [] }))
            }
            s.dottedLines    = d.dottedLines    ?? []
            s.peerLines      = d.peerLines      ?? []
            s.chartContacts  = d.chartContacts  ?? []
            s.positions      = d.positions      ?? {}
            s.activeChartOrg = d.activeChartOrg ?? null
            s.savedCharts    = d.savedCharts    ?? []
            s.emailSettings  = d.emailSettings  ?? {}
          })
          // Re-assign tasks into the now-correct bucket defs
          rebuildTaskBuckets()
        } else {
          // No settings doc yet — write defaults
          writeSettings(userUid, {
            bucketDefs: DEFAULT_BUCKET_DEFS,
            dottedLines: [], peerLines: [], chartContacts: [],
            positions: {}, activeChartOrg: null, savedCharts: [], emailSettings: {},
          })
        }
        markLoaded()
      }, (e) => { console.error('[settings snapshot]', e); markLoaded() }))

      return () => { unsubs.forEach(u => u()) }
    },

    // ── Contacts ──────────────────────────────────────────────────────────────
    addContact: (contact) => {
      set(s => { s.contacts.push(contact) })
      const u = get().uid; if (u) writeContact(u, contact)
    },

    updateContact: (contact) => {
      set(s => { const i = s.contacts.findIndex(c => c.id === contact.id); if (i >= 0) s.contacts[i] = contact })
      const u = get().uid; if (u) writeContact(u, contact)
    },

    deleteContact: (id) => {
      set(s => {
        s.contacts = s.contacts.filter(c => c.id !== id)
        s.contacts.forEach(c => { if (c.parentId === id) c.parentId = '' })
        s.dottedLines   = s.dottedLines.filter(d => d.fromId !== id && d.toId !== id)
        s.peerLines     = s.peerLines.filter(d => d.fromId !== id && d.toId !== id)
        s.chartContacts = s.chartContacts.filter(x => x !== id)
        delete s.positions[id]
      })
      const u = get().uid
      if (u) {
        removeContact(u, id)
        writeSettings(u, buildSettingsDoc(get()))
      }
    },

    // ── Org chart ─────────────────────────────────────────────────────────────
    setPositions: (positions) => {
      set(s => { s.positions = positions })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    setChartContacts: (ids) => {
      set(s => { s.chartContacts = ids })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    setActiveChartOrg: (org) => {
      set(s => { s.activeChartOrg = org })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    addDottedLine: (line) => {
      set(s => { s.dottedLines.push(line) })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    removeDottedLine: (fromId, toId) => {
      set(s => { s.dottedLines = s.dottedLines.filter(d => !(d.fromId === fromId && d.toId === toId)) })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    addPeerLine: (line) => {
      set(s => { s.peerLines.push(line) })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    removePeerLine: (fromId, toId) => {
      set(s => { s.peerLines = s.peerLines.filter(d => !(d.fromId === fromId && d.toId === toId)) })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    saveChart: (chart) => {
      set(s => { s.savedCharts.push(chart) })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    deleteChart: (id) => {
      set(s => { s.savedCharts = s.savedCharts.filter(c => c.id !== id) })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    // ── Meetings ──────────────────────────────────────────────────────────────
    addMeeting: (meeting) => {
      set(s => { s.meetings.push(meeting) })
      const u = get().uid; if (u) writeMeeting(u, meeting)
    },

    updateMeeting: (meeting) => {
      set(s => { const i = s.meetings.findIndex(m => m.id === meeting.id); if (i >= 0) s.meetings[i] = meeting })
      const u = get().uid; if (u) writeMeeting(u, meeting)
    },

    deleteMeeting: (id) => {
      set(s => { s.meetings = s.meetings.filter(m => m.id !== id) })
      const u = get().uid; if (u) removeMeeting(u, id)
    },

    saveMeetingWithTasks: (meeting) => {
      let result: Meeting = meeting
      const tasksToWrite: Array<{ bucketId: string; task: Task }> = []

      set(s => {
        const bucketId = 'unsorted'
        const bucket = s.taskBuckets.find(b => b.id === bucketId) ?? s.taskBuckets[0]
        if (!bucket) return

        const updatedItems = meeting.actionItems.map(item => {
          if (item.done) {
            if (item.taskId) {
              for (const b of s.taskBuckets) {
                const t = b.tasks.find(t => t.id === item.taskId)
                if (t) {
                  t.progress = 100
                  tasksToWrite.push({ bucketId: b.id, task: { ...t, progress: 100 } })
                  break
                }
              }
            }
            return item
          }

          if (item.taskId) {
            for (const b of s.taskBuckets) {
              const idx = b.tasks.findIndex(t => t.id === item.taskId)
              if (idx >= 0) {
                const updated = { ...b.tasks[idx], text: item.text, priority: item.priority, due: item.due, notes: `From meeting: ${meeting.title}` }
                b.tasks[idx] = updated
                tasksToWrite.push({ bucketId: b.id, task: updated })
                break
              }
            }
            return item
          }

          const newId = uid()
          const newTask: Task = {
            id: newId, text: item.text, priority: item.priority, due: item.due,
            notes: `From meeting: ${meeting.title}`, createdAt: Date.now(),
          }
          bucket.tasks.push(newTask)
          tasksToWrite.push({ bucketId: bucket.id, task: newTask })
          return { ...item, taskId: newId }
        })

        result = { ...meeting, actionItems: updatedItems }
        const existingIdx = s.meetings.findIndex(m => m.id === meeting.id)
        if (existingIdx >= 0) s.meetings[existingIdx] = result
        else s.meetings.push(result)
      })

      const u = get().uid
      if (u) {
        // Use batch to atomically write meeting + all affected tasks
        const batch = writeBatch(db)
        batch.set(docRef(u, 'meetings', result.id), result)
        for (const { bucketId, task } of tasksToWrite) {
          batch.set(docRef(u, 'tasks', task.id), { ...task, bucketId })
        }
        batch.commit().catch(e => console.error('[saveMeetingWithTasks batch]', e))
      }

      return result
    },

    // ── Tasks ─────────────────────────────────────────────────────────────────
    setTaskBuckets: (buckets) => {
      set(s => { s.taskBuckets = buckets })
      const u = get().uid
      if (!u) return
      // Write the bucket definitions (without tasks) to settings
      writeSettings(u, buildSettingsDoc(get()))
      // Write all tasks (in case tasks were moved between buckets)
      const batch = writeBatch(db)
      for (const b of buckets) {
        for (const task of b.tasks) {
          batch.set(docRef(u, 'tasks', task.id), { ...task, bucketId: b.id })
        }
      }
      batch.commit().catch(e => console.error('[setTaskBuckets batch]', e))
    },

    addTask: (bucketId, task) => {
      set(s => { const b = s.taskBuckets.find(b => b.id === bucketId); if (b) b.tasks.push(task) })
      const u = get().uid; if (u) writeTask(u, bucketId, task)
    },

    updateTask: (bucketId, task) => {
      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) {
          const idx = bucket.tasks.findIndex(t => t.id === task.id)
          if (idx >= 0) bucket.tasks[idx] = task
        }
        // Sync to timeline items
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
        // Sync done state to meeting action items
        if (task.progress === 100) {
          s.meetings.forEach(m => {
            m.actionItems.forEach(a => { if (a.taskId === task.id) a.done = true })
          })
        }
      })
      const u = get().uid
      if (!u) return
      writeTask(u, bucketId, task)
      // Write any timelines that were affected
      const affectedTimelines = get().timelines.filter(tl => tl.items.some(i => i.taskId === task.id))
      affectedTimelines.forEach(tl => writeTimeline(u, tl))
      // Write any meetings that were affected (if task became done)
      if (task.progress === 100) {
        const affectedMeetings = get().meetings.filter(m => m.actionItems.some(a => a.taskId === task.id))
        affectedMeetings.forEach(m => writeMeeting(u, m))
      }
    },

    moveTask: (taskId, fromBucketId, toBucketId) => {
      let movedTask: Task | null = null
      set(s => {
        const fromBucket = s.taskBuckets.find(b => b.id === fromBucketId)
        const toBucket   = s.taskBuckets.find(b => b.id === toBucketId)
        if (!fromBucket || !toBucket) return
        const taskIdx = fromBucket.tasks.findIndex(t => t.id === taskId)
        if (taskIdx < 0) return
        const [task] = fromBucket.tasks.splice(taskIdx, 1)
        if (toBucketId === 'done') {
          task.progress = 100
          s.meetings.forEach(m => {
            m.actionItems.forEach(a => { if (a.taskId === taskId) a.done = true })
          })
        }
        toBucket.tasks.push(task)
        movedTask = task
      })
      const u = get().uid
      if (!u || !movedTask) return
      // Just update the task doc with new bucketId (atomic, no full-collection write)
      writeTask(u, toBucketId, movedTask)
      if (toBucketId === 'done') {
        const affectedMeetings = get().meetings.filter(m => m.actionItems.some(a => a.taskId === taskId))
        affectedMeetings.forEach(m => writeMeeting(u, m))
      }
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    setEmailSettings: (settings) => {
      set(s => { s.emailSettings = settings })
      const u = get().uid; if (u) writeSettings(u, buildSettingsDoc(get()))
    },

    // ── Timelines ─────────────────────────────────────────────────────────────
    addTimeline: (t) => {
      set(s => { s.timelines.push(t) })
      const u = get().uid; if (u) writeTimeline(u, t)
    },

    updateTimeline: (t) => {
      set(s => { const i = s.timelines.findIndex(x => x.id === t.id); if (i >= 0) s.timelines[i] = t })
      const u = get().uid; if (u) writeTimeline(u, t)
    },

    deleteTimeline: (id) => {
      set(s => { s.timelines = s.timelines.filter(t => t.id !== id) })
      const u = get().uid; if (u) removeTimeline(u, id)
    },

    // ── Atomic cross-feature mutations ────────────────────────────────────────
    addTaskAndUpdateTimeline: (bucketId, task, timelineId, updatedItem) => {
      const subTasks: SubTask[] = (updatedItem.subItems ?? []).map(si => ({
        id: si.subTaskId ?? si.id,
        text: si.label || 'Untitled',
        startDate: si.startDate || undefined,
        due: si.endDate || undefined,
        progress: si.progress,
        done: si.done,
      }))
      const taggedSubItems = (updatedItem.subItems ?? []).map(si => ({
        ...si, subTaskId: si.subTaskId ?? si.id,
      }))
      const taskWithSubs  = { ...task, subTasks: subTasks.length > 0 ? subTasks : undefined }
      const itemWithTagged = { ...updatedItem, subItems: taggedSubItems.length > 0 ? taggedSubItems : undefined }

      let updatedTimeline: Timeline | null = null
      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) bucket.tasks.push(taskWithSubs)
        const tl = s.timelines.find(x => x.id === timelineId)
        if (tl) {
          const idx = tl.items.findIndex(i => i.id === itemWithTagged.id)
          if (idx >= 0) tl.items[idx] = itemWithTagged
          else tl.items.push(itemWithTagged)
          updatedTimeline = tl
        }
      })
      const u = get().uid
      if (!u) return
      const tl = updatedTimeline ?? get().timelines.find(x => x.id === timelineId)
      if (tl) batchWriteTaskAndTimeline(u, bucketId, taskWithSubs, tl)
        .catch(e => console.error('[addTaskAndUpdateTimeline batch]', e))
    },

    saveTaskWithTimelineItem: (bucketId, task) => {
      let affectedTimeline: Timeline | null = null
      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) {
          const idx = bucket.tasks.findIndex(t => t.id === task.id)
          if (idx >= 0) bucket.tasks[idx] = task
          else bucket.tasks.push(task)
        }

        if (task.timelineId) {
          const tl = s.timelines.find(x => x.id === task.timelineId)
          if (tl) {
            const existingItem = tl.items.find(i => i.taskId === task.id)
            const today = new Date().toISOString().split('T')[0]
            const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
            const laneId = task.swimLaneId ?? tl.swimLanes[0]?.id ?? ''
            if (existingItem) {
              existingItem.label = task.text
              if (task.startDate) existingItem.startDate = task.startDate
              if (task.due) existingItem.endDate = task.due
              if (task.progress !== undefined) existingItem.progress = task.progress ?? 0
              if (task.swimLaneId) existingItem.swimLaneId = task.swimLaneId
            } else {
              const lane = tl.swimLanes.find(l => l.id === laneId)
              tl.items.push({
                id: task.id + '_bar',
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
            affectedTimeline = tl
          }
        } else {
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

      const u = get().uid
      if (!u) return
      if (affectedTimeline) {
        batchWriteTaskAndTimeline(u, bucketId, task, affectedTimeline)
          .catch(e => console.error('[saveTaskWithTimelineItem batch]', e))
      } else {
        writeTask(u, bucketId, task)
        // Write any timelines affected by the label/progress sync
        get().timelines.filter(tl => tl.items.some(i => i.taskId === task.id))
          .forEach(tl => writeTimeline(u, tl))
      }
    },

    saveSubTaskWithTimelineSync: (bucketId, parentTaskId, sub, subItemId) => {
      let affectedTask: Task | null = null
      let affectedTimeline: Timeline | null = null

      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        const task = bucket?.tasks.find(t => t.id === parentTaskId)
        if (task) {
          if (!task.subTasks) task.subTasks = []
          const idx = task.subTasks.findIndex(st => st.id === sub.id)
          if (idx >= 0) task.subTasks[idx] = sub
          else task.subTasks.push(sub)
          const span = subtaskDateSpan(task.subTasks)
          if (span.startDate) task.startDate = span.startDate
          if (span.due)       task.due        = span.due
          affectedTask = task
        }

        for (const tl of s.timelines) {
          const item = tl.items.find(i => i.taskId === parentTaskId)
          if (item) {
            if (!item.subItems) item.subItems = []
            const siIdx = item.subItems.findIndex(si => si.id === subItemId)
            const subStart = sub.startDate ?? item.subItems[siIdx]?.startDate ?? item.startDate
            const subEnd   = sub.due       ?? item.subItems[siIdx]?.endDate   ?? item.endDate
            const newSubItem = { id: subItemId, label: sub.text, startDate: subStart, endDate: subEnd, progress: sub.progress ?? 0, done: sub.done, subTaskId: sub.id }
            if (siIdx >= 0) item.subItems[siIdx] = newSubItem
            else item.subItems.push(newSubItem)
            const allStarts = item.subItems.map(si => si.startDate).filter(Boolean) as string[]
            const allEnds   = item.subItems.map(si => si.endDate).filter(Boolean) as string[]
            if (allStarts.length) item.startDate = allStarts.reduce((a, b) => a < b ? a : b)
            if (allEnds.length)   item.endDate   = allEnds.reduce((a, b) => a > b ? a : b)
            affectedTimeline = tl
            break
          }
        }
      })

      const u = get().uid
      if (!u) return
      if (affectedTask && affectedTimeline) {
        batchWriteTaskAndTimeline(u, bucketId, affectedTask, affectedTimeline)
          .catch(e => console.error('[saveSubTaskWithTimelineSync batch]', e))
      } else if (affectedTask) {
        writeTask(u, bucketId, affectedTask)
      }
    },

    deleteSubTaskWithTimelineSync: (bucketId, parentTaskId, subId) => {
      let affectedTask: Task | null = null
      let affectedTimeline: Timeline | null = null

      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        const task = bucket?.tasks.find(t => t.id === parentTaskId)
        if (task) {
          task.subTasks = (task.subTasks ?? []).filter(st => st.id !== subId)
          const span = subtaskDateSpan(task.subTasks ?? [])
          if (span.startDate) task.startDate = span.startDate
          if (span.due)       task.due        = span.due
          affectedTask = task
        }

        for (const tl of s.timelines) {
          const item = tl.items.find(i => i.taskId === parentTaskId)
          if (item) {
            item.subItems = (item.subItems ?? []).filter(si => si.id !== subId && si.subTaskId !== subId)
            const allStarts = (item.subItems ?? []).map(si => si.startDate).filter(Boolean) as string[]
            const allEnds   = (item.subItems ?? []).map(si => si.endDate).filter(Boolean) as string[]
            if (allStarts.length) item.startDate = allStarts.reduce((a, b) => a < b ? a : b)
            if (allEnds.length)   item.endDate   = allEnds.reduce((a, b) => a > b ? a : b)
            affectedTimeline = tl
            break
          }
        }
      })

      const u = get().uid
      if (!u) return
      if (affectedTask && affectedTimeline) {
        batchWriteTaskAndTimeline(u, bucketId, affectedTask, affectedTimeline)
          .catch(e => console.error('[deleteSubTaskWithTimelineSync batch]', e))
      } else if (affectedTask) {
        writeTask(u, bucketId, affectedTask)
      }
    },

    syncBarSubItemsToTask: (updatedItem) => {
      if (!updatedItem.taskId || !updatedItem.subItems?.length) return
      let affectedBucketId: string | null = null
      let affectedTask: Task | null = null
      let affectedTimeline: Timeline | null = null

      set(s => {
        for (const bucket of s.taskBuckets) {
          const taskIdx = bucket.tasks.findIndex(x => x.id === updatedItem.taskId)
          if (taskIdx >= 0) {
            affectedBucketId = bucket.id
            const task = bucket.tasks[taskIdx]
            if (!task.subTasks) task.subTasks = []
            for (const si of updatedItem.subItems ?? []) {
              const subId = si.subTaskId ?? si.id
              const existingIdx = task.subTasks.findIndex(st => st.id === subId)
              const asSub: SubTask = { id: subId, text: si.label || 'Untitled', startDate: si.startDate || undefined, due: si.endDate || undefined, progress: si.progress, done: si.done }
              if (existingIdx >= 0) task.subTasks[existingIdx] = { ...task.subTasks[existingIdx], ...asSub }
              else task.subTasks.push(asSub)
            }
            const span = subtaskDateSpan(task.subTasks)
            if (span.startDate) task.startDate = span.startDate
            if (span.due) task.due = span.due
            affectedTask = task
            break
          }
        }

        for (const tl of s.timelines) {
          const itemIdx = tl.items.findIndex(i => i.id === updatedItem.id)
          if (itemIdx >= 0) {
            tl.items[itemIdx] = {
              ...updatedItem,
              subItems: (updatedItem.subItems ?? []).map(si => ({ ...si, subTaskId: si.subTaskId ?? si.id })),
            }
            affectedTimeline = tl
            break
          }
        }
      })

      const u = get().uid
      if (!u || !affectedBucketId || !affectedTask) return
      if (affectedTimeline) {
        batchWriteTaskAndTimeline(u, affectedBucketId, affectedTask, affectedTimeline)
          .catch(e => console.error('[syncBarSubItemsToTask batch]', e))
      } else {
        writeTask(u, affectedBucketId, affectedTask)
      }
    },

    // ── Demo data ─────────────────────────────────────────────────────────────
    loadDemoData: () => {
      const u = get().uid
      const demoContacts = buildDemoContacts()
      const demoMeetings = buildDemoMeetings()
      const { demoTasks, demoTimeline } = buildDemoTasksAndTimeline()

      set(s => {
        for (const c of demoContacts) {
          if (!s.contacts.find(x => x.id === c.id)) s.contacts.push(c)
        }
        const demoIds = demoContacts.map(c => c.id)
        for (const id of demoIds) {
          if (!s.chartContacts.includes(id)) s.chartContacts.push(id)
        }
        for (const [id, p] of Object.entries(demoPosMap())) {
          if (!s.positions[id]) s.positions[id] = p
        }
        for (const m of demoMeetings) {
          if (!s.meetings.find(x => x.id === m.id)) s.meetings.push(m)
        }
        for (const [bucketId, tasks] of Object.entries(demoTasks)) {
          const bucket = s.taskBuckets.find(b => b.id === bucketId)
          if (bucket) {
            for (const t of tasks) {
              if (!bucket.tasks.find(x => x.id === t.id)) bucket.tasks.push(t)
            }
          }
        }
        if (!s.timelines.find(tl => tl.id === demoTimeline.id)) s.timelines.push(demoTimeline)
      })

      if (!u) return
      // Write all demo data individually
      const batch = writeBatch(db)
      for (const c of demoContacts) batch.set(docRef(u, 'contacts', c.id), c)
      for (const m of demoMeetings) batch.set(docRef(u, 'meetings', m.id), m)
      for (const [bucketId, tasks] of Object.entries(demoTasks)) {
        for (const task of tasks) batch.set(docRef(u, 'tasks', task.id), { ...task, bucketId })
      }
      batch.set(docRef(u, 'timelines', demoTimeline.id), demoTimeline)
      batch.commit().catch(e => console.error('[loadDemoData batch]', e))
      writeSettings(u, buildSettingsDoc(get()))
    },

    clearDemoData: () => {
      const u = get().uid
      const demoContactIds = ['demo-c1','demo-c2','demo-c3','demo-c4','demo-c5','demo-c6','demo-c7','demo-c8']

      set(s => {
        s.contacts      = s.contacts.filter(c => !c.id.startsWith('demo-'))
        s.dottedLines   = s.dottedLines.filter(d => !demoContactIds.includes(d.fromId) && !demoContactIds.includes(d.toId))
        s.peerLines     = s.peerLines.filter(d => !demoContactIds.includes(d.fromId) && !demoContactIds.includes(d.toId))
        s.chartContacts = s.chartContacts.filter(id => !id.startsWith('demo-'))
        for (const id of demoContactIds) delete s.positions[id]
        s.meetings      = s.meetings.filter(m => !m.id.startsWith('demo-'))
        for (const b of s.taskBuckets) b.tasks = b.tasks.filter(t => !t.id.startsWith('demo-'))
        s.timelines     = s.timelines.filter(tl => !tl.id.startsWith('demo-'))
      })

      if (!u) return
      const batch = writeBatch(db)
      for (const id of demoContactIds) batch.delete(docRef(u, 'contacts', id))
      for (const id of ['demo-m1','demo-m2','demo-m3']) batch.delete(docRef(u, 'meetings', id))
      for (const id of ['demo-t1','demo-t2','demo-t3','demo-t4','demo-t5','demo-t6','demo-t7']) batch.delete(docRef(u, 'tasks', id))
      batch.delete(docRef(u, 'timelines', 'demo-tl1'))
      batch.commit().catch(e => console.error('[clearDemoData batch]', e))
      writeSettings(u, buildSettingsDoc(get()))
    },
  }))
)

// ─── Settings doc builder ─────────────────────────────────────────────────────
function buildSettingsDoc(state: StoreState): SettingsDoc {
  return {
    bucketDefs: state.taskBuckets.map(({ id, name, color }) => ({ id, name, color })),
    dottedLines:    state.dottedLines,
    peerLines:      state.peerLines,
    chartContacts:  state.chartContacts,
    positions:      state.positions,
    activeChartOrg: state.activeChartOrg,
    savedCharts:    state.savedCharts,
    emailSettings:  state.emailSettings,
  }
}

// ─── Demo data builders ───────────────────────────────────────────────────────
function buildDemoContacts(): Contact[] {
  const c1='demo-c1',c2='demo-c2',c3='demo-c3',c4='demo-c4',c5='demo-c5',c6='demo-c6',c7='demo-c7',c8='demo-c8'
  return [
    { id:c1, name:'Sarah Chen',   title:'Chief Executive Officer',  org:'Acme Corp', level:'c-level',    email:'sarah@acme.com',  createdAt:1700000001000 },
    { id:c2, name:'Marcus Webb',  title:'VP Engineering',           org:'Acme Corp', level:'gm',          email:'marcus@acme.com', createdAt:1700000002000, parentId:c1 },
    { id:c3, name:'Priya Nair',   title:'VP Product',               org:'Acme Corp', level:'gm',          email:'priya@acme.com',  createdAt:1700000003000, parentId:c1 },
    { id:c4, name:'Tom Okafor',   title:'Engineering Manager',      org:'Acme Corp', level:'manager',     email:'tom@acme.com',    createdAt:1700000004000, parentId:c2 },
    { id:c5, name:'Lena Fischer', title:'Senior Software Engineer', org:'Acme Corp', level:'individual',  email:'lena@acme.com',   createdAt:1700000005000, parentId:c4 },
    { id:c6, name:'James Park',   title:'Software Engineer',        org:'Acme Corp', level:'individual',  email:'james@acme.com',  createdAt:1700000006000, parentId:c4 },
    { id:c7, name:'Aisha Mensah', title:'Head of Design',           org:'Acme Corp', level:'head-of',     email:'aisha@acme.com',  createdAt:1700000007000, parentId:c3 },
    { id:c8, name:'David Ruiz',   title:'Product Manager',          org:'Acme Corp', level:'manager',     email:'david@acme.com',  createdAt:1700000008000, parentId:c3 },
  ]
}

function demoPosMap(): Record<string, Position> {
  return {
    'demo-c1':{ x:400,y:60 }, 'demo-c2':{ x:200,y:180 }, 'demo-c3':{ x:600,y:180 },
    'demo-c4':{ x:100,y:300 },'demo-c5':{ x:0,  y:420 }, 'demo-c6':{ x:200,y:420 },
    'demo-c7':{ x:500,y:300 },'demo-c8':{ x:700,y:300 },
  }
}

function buildDemoMeetings(): Meeting[] {
  const c1='demo-c1',c2='demo-c2',c4='demo-c4',c5='demo-c5',c6='demo-c6',c3='demo-c3',c7='demo-c7',c8='demo-c8'
  return [
    { id:'demo-m1', title:'Q2 Engineering Planning', date:'2026-04-14', attendees:[c1,c2,c4],
      discussion:'Reviewed roadmap for Q2. Agreed to prioritise the new API gateway before mobile app work. Security audit to be scheduled.',
      actionItems:[
        { id:'demo-ai1', text:'Draft API gateway spec',      done:false, assignee:c2, priority:'high',   due:'2026-04-18' },
        { id:'demo-ai2', text:'Schedule security audit',     done:false, assignee:c4, priority:'medium', due:'2026-04-21' },
        { id:'demo-ai3', text:'Update sprint board',         done:true,  assignee:c4, priority:'low' },
      ], createdAt:1700000010000 },
    { id:'demo-m2', title:'Product Design Review', date:'2026-04-16', attendees:[c3,c7,c8],
      discussion:'Walked through new onboarding flow designs. Feedback: simplify step 3, add progress indicator, use existing component library colours.',
      actionItems:[
        { id:'demo-ai4', text:'Simplify onboarding step 3 designs',        done:false, assignee:c7, priority:'high',   due:'2026-04-20' },
        { id:'demo-ai5', text:'Write acceptance criteria for onboarding',   done:false, assignee:c8, priority:'medium', due:'2026-04-22' },
      ], createdAt:1700000020000 },
    { id:'demo-m3', title:'Weekly Standup', date:'2026-04-10', attendees:[c2,c4,c5,c6],
      discussion:'Status: auth service refactor is 80% done. Lena blocked on test environment. James finishing PR review.',
      actionItems:[
        { id:'demo-ai6', text:'Unblock test environment for Lena', done:false, assignee:c4, priority:'high', due:'2026-04-11' },
        { id:'demo-ai7', text:'Merge auth refactor PR',            done:false, assignee:c5, priority:'high', due:'2026-04-12' },
      ], createdAt:1700000030000 },
  ]
}

function buildDemoTasksAndTimeline(): { demoTasks: Record<string, Task[]>; demoTimeline: Timeline } {
  const lane1='demo-lane1', lane2='demo-lane2', lane3='demo-lane3'
  const demoTasks: Record<string, Task[]> = {
    backlog: [
      { id:'demo-t1', text:'Implement API gateway', priority:'high', startDate:'2026-04-21', due:'2026-05-09',
        notes:'Design-first approach. Covers auth, rate limiting, and routing.', progress:0, createdAt:1700000040000,
        subTasks:[
          { id:'demo-st1', text:'Write API spec',            priority:'high',   startDate:'2026-04-21', due:'2026-04-25', progress:0 },
          { id:'demo-st2', text:'Set up gateway infra',      priority:'medium', startDate:'2026-04-28', due:'2026-05-02', progress:0 },
          { id:'demo-st3', text:'Implement auth middleware',  priority:'high',   startDate:'2026-05-05', due:'2026-05-09', progress:0 },
        ] },
      { id:'demo-t2', text:'Mobile app push notifications', priority:'medium', startDate:'2026-05-12', due:'2026-05-23', progress:0, createdAt:1700000041000 },
    ],
    inprogress: [
      { id:'demo-t3', text:'Auth service refactor', priority:'high', startDate:'2026-04-01', due:'2026-04-12', progress:80, createdAt:1700000042000,
        subTasks:[
          { id:'demo-st4', text:'Migrate to JWT tokens',    priority:'high',   startDate:'2026-04-01', due:'2026-04-05', done:true,  progress:100 },
          { id:'demo-st5', text:'Update session handling',  priority:'medium', startDate:'2026-04-07', due:'2026-04-10', done:true,  progress:100 },
          { id:'demo-st6', text:'Write integration tests',  priority:'medium', startDate:'2026-04-11', due:'2026-04-12', progress:40 },
        ] },
      { id:'demo-t4', text:'Onboarding flow redesign', priority:'high', startDate:'2026-04-14', due:'2026-04-25', progress:20, createdAt:1700000043000,
        subTasks:[
          { id:'demo-st7', text:'Simplify step 3 UI',      priority:'high',   startDate:'2026-04-14', due:'2026-04-18', progress:30 },
          { id:'demo-st8', text:'Add progress indicator',  priority:'medium', startDate:'2026-04-21', due:'2026-04-25', progress:0  },
        ] },
      { id:'demo-t5', text:'Analytics dashboard v2', priority:'medium', startDate:'2026-04-07', due:'2026-04-18', progress:50, createdAt:1700000044000 },
    ],
    done: [
      { id:'demo-t6', text:'Set up CI/CD pipeline',       priority:'medium', startDate:'2026-03-17', due:'2026-03-28', progress:100, createdAt:1700000045000 },
      { id:'demo-t7', text:'Database schema migration',   priority:'high',   startDate:'2026-03-24', due:'2026-04-04', progress:100, createdAt:1700000046000 },
    ],
  }

  const demoTimeline: Timeline = {
    id:'demo-tl1', name:'Q2 2026 Roadmap', createdAt:1700000050000,
    timescale:'months', subTimescale:'weeks', yearMode:'calendar',
    startDate:'2026-04-01', endDate:'2026-06-30', labelWidth:180,
    swimLanes:[
      { id:lane1, label:'Engineering',      color:'#6366f1' },
      { id:lane2, label:'Product & Design', color:'#3b82f6' },
      { id:lane3, label:'Infrastructure',   color:'#10b981' },
    ],
    milestones:[
      { id:'demo-ms1', label:'API Gateway Launch', date:'2026-05-09', color:'#ef4444' },
      { id:'demo-ms2', label:'Q2 Review',          date:'2026-06-27', color:'#f59e0b' },
    ],
    items:[
      { id:'demo-t3_bar', swimLaneId:lane1, label:'Auth service refactor', type:'bar',
        startDate:'2026-04-01', endDate:'2026-04-12', color:'#6366f1', progress:80, taskId:'demo-t3',
        subItems:[
          { id:'demo-st4', label:'Migrate to JWT tokens',   startDate:'2026-04-01', endDate:'2026-04-05', progress:100, done:true,  subTaskId:'demo-st4' },
          { id:'demo-st5', label:'Update session handling', startDate:'2026-04-07', endDate:'2026-04-10', progress:100, done:true,  subTaskId:'demo-st5' },
          { id:'demo-st6', label:'Write integration tests', startDate:'2026-04-11', endDate:'2026-04-12', progress:40,  done:false, subTaskId:'demo-st6' },
        ] },
      { id:'demo-t1_bar', swimLaneId:lane1, label:'API gateway implementation', type:'bar',
        startDate:'2026-04-21', endDate:'2026-05-09', color:'#6366f1', progress:0, taskId:'demo-t1',
        subItems:[
          { id:'demo-st1', label:'Write API spec',            startDate:'2026-04-21', endDate:'2026-04-25', progress:0, subTaskId:'demo-st1' },
          { id:'demo-st2', label:'Set up gateway infra',      startDate:'2026-04-28', endDate:'2026-05-02', progress:0, subTaskId:'demo-st2' },
          { id:'demo-st3', label:'Implement auth middleware',  startDate:'2026-05-05', endDate:'2026-05-09', progress:0, subTaskId:'demo-st3' },
        ] },
      { id:'demo-t2_bar', swimLaneId:lane1, label:'Push notifications', type:'bar',
        startDate:'2026-05-12', endDate:'2026-05-23', color:'#8b5cf6', progress:0, taskId:'demo-t2' },
      { id:'demo-t4_bar', swimLaneId:lane2, label:'Onboarding redesign', type:'bar',
        startDate:'2026-04-14', endDate:'2026-04-25', color:'#3b82f6', progress:20, taskId:'demo-t4',
        subItems:[
          { id:'demo-st7', label:'Simplify step 3 UI',     startDate:'2026-04-14', endDate:'2026-04-18', progress:30, subTaskId:'demo-st7' },
          { id:'demo-st8', label:'Add progress indicator', startDate:'2026-04-21', endDate:'2026-04-25', progress:0,  subTaskId:'demo-st8' },
        ] },
      { id:'demo-t5_bar', swimLaneId:lane2, label:'Analytics dashboard v2', type:'bar',
        startDate:'2026-04-07', endDate:'2026-04-18', color:'#ec4899', progress:50, taskId:'demo-t5' },
      { id:'demo-infra1', swimLaneId:lane3, label:'Security audit', type:'bar',
        startDate:'2026-04-22', endDate:'2026-05-06', color:'#10b981', progress:0 },
      { id:'demo-infra2', swimLaneId:lane3, label:'Cloud cost review', type:'bar',
        startDate:'2026-05-12', endDate:'2026-05-16', color:'#10b981', progress:0 },
    ],
  }
  return { demoTasks, demoTimeline }
}
