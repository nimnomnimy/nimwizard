import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  doc, setDoc, deleteDoc, onSnapshot, collection,
  writeBatch, getDocs, getDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useCurrency } from './useCurrency'
import type {
  AppState, Contact, Meeting, TaskBucket, SavedChart, DottedLine,
  PeerLine, Position, EmailSettings, Timeline, TimelineItem, SubTask, Task, Diagram,
  DealProduct, Deal, CustomerConfig, Pricebook, Contract,
} from '../types'
import { uid } from '../lib/utils'

// ─── Firestore path helpers ───────────────────────────────────────────────────
// Schema:
//   users/{uid}/contacts/{contactId}
//   users/{uid}/meetings/{meetingId}
//   users/{uid}/tasks/{taskId}          (includes bucketId field)
//   users/{uid}/timelines/{timelineId}
//   users/{uid}/diagrams/{diagramId}
//   users/{uid}/dealProducts/{productId}
//   users/{uid}/deals/{dealId}
//   users/{uid}/settings/app            (buckets, email, saved charts)
//   users/{uid}/orgchart/state          (positions, lines, chartContacts, savedCharts)

const colRef      = (uid: string, sub: string) => collection(db, 'users', uid, sub)
const docRef      = (uid: string, sub: string, id: string) => doc(db, 'users', uid, sub, id)
const settingsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'app')
const orgchartRef = (uid: string) => doc(db, 'users', uid, 'orgchart', 'state')

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
  emailSettings: EmailSettings
  usdToAudRate?: number
}

// ─── Org chart document shape (stored at users/{uid}/orgchart/state) ──────────
interface OrgchartDoc {
  dottedLines: DottedLine[]
  peerLines: PeerLine[]
  chartContacts: string[]
  positions: Record<string, Position>
  activeChartOrg: string | null
  savedCharts: SavedChart[]
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
const TOTAL_COLLECTIONS = 10 // contacts, meetings, tasks, timelines, diagrams, dealProducts, deals, customerConfigs, pricebooks, contracts (+settings+orgchart)

// ─── Store interface ──────────────────────────────────────────────────────────
interface StoreState extends AppState {
  uid: string | null
  loading: boolean          // true until ALL collections have fired once
  contactsReady: boolean
  meetingsReady: boolean
  tasksReady: boolean
  timelinesReady: boolean
  syncing: boolean

  setUid: (uid: string | null) => void
  setLoading: (loading: boolean) => void

  loadUserData: (uid: string) => Promise<Unsubscribe>
  saveUserData: () => void  // kept for compatibility; now a no-op (each action saves itself)

  // Contacts
  addContact: (contact: Contact) => void
  updateContact: (contact: Contact) => void
  deleteContact: (id: string) => void
  importContacts: (contacts: Contact[]) => void  // batch-add, single Firestore write

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
  deleteTask: (taskId: string) => void
  moveTask: (taskId: string, fromBucketId: string, toBucketId: string) => void

  // Settings
  setEmailSettings: (settings: EmailSettings) => void
  saveFxRate: (usdToAudRate: number) => void

  // Timelines
  addTimeline: (t: Timeline) => void
  updateTimeline: (t: Timeline) => void
  deleteTimeline: (id: string) => void

  // Diagrams
  addDiagram: (d: Diagram) => void
  updateDiagram: (d: Diagram) => void
  deleteDiagram: (id: string) => void

  // Deal Engine — Products
  addDealProduct: (p: DealProduct) => void
  updateDealProduct: (p: DealProduct) => void
  deleteDealProduct: (id: string) => void

  // Deal Engine — Deals
  addDeal: (d: Deal) => void
  updateDeal: (d: Deal) => void
  deleteDeal: (id: string) => void

  // Customer Configs
  addCustomerConfig: (c: CustomerConfig) => void
  updateCustomerConfig: (c: CustomerConfig) => void
  deleteCustomerConfig: (id: string) => void

  // Pricebooks
  addPricebook: (p: Pricebook) => void
  updatePricebook: (p: Pricebook) => void
  deletePricebook: (id: string) => void

  // Contracts
  addContract: (c: Contract) => void
  updateContract: (c: Contract) => void
  deleteContract: (id: string) => void

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
// All write helpers return a Promise so callers can handle errors and revert.

// Firestore rejects undefined values — strip them before writing
function stripUndefined<T extends object>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T
}

function writeContact(userUid: string, contact: Contact): Promise<void> {
  return setDoc(docRef(userUid, 'contacts', contact.id), contact)
}

function removeContact(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'contacts', id))
}

function writeMeeting(userUid: string, meeting: Meeting): Promise<void> {
  return setDoc(docRef(userUid, 'meetings', meeting.id), meeting)
}

function removeMeeting(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'meetings', id))
}

function writeTask(userUid: string, bucketId: string, task: Task): Promise<void> {
  return setDoc(docRef(userUid, 'tasks', task.id), stripUndefined({ ...task, bucketId }))
}


function writeTimeline(userUid: string, timeline: Timeline): Promise<void> {
  return setDoc(docRef(userUid, 'timelines', timeline.id), stripUndefined(timeline))
}

function removeTimeline(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'timelines', id))
}

function writeDiagram(userUid: string, diagram: Diagram): Promise<void> {
  return setDoc(docRef(userUid, 'diagrams', diagram.id), stripUndefined(diagram))
}

function removeDiagram(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'diagrams', id))
}

function writeDealProduct(userUid: string, p: DealProduct): Promise<void> {
  return setDoc(docRef(userUid, 'dealProducts', p.id), stripUndefined(p))
}

function removeDealProduct(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'dealProducts', id))
}

function writeDeal(userUid: string, d: Deal): Promise<void> {
  return setDoc(docRef(userUid, 'deals', d.id), stripUndefined(d))
}

function removeDeal(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'deals', id))
}

function writeCustomerConfig(userUid: string, c: CustomerConfig): Promise<void> {
  return setDoc(docRef(userUid, 'customerConfigs', c.id), stripUndefined(c))
}

function removeCustomerConfig(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'customerConfigs', id))
}

function writePricebook(userUid: string, p: Pricebook): Promise<void> {
  return setDoc(docRef(userUid, 'pricebooks', p.id), stripUndefined(p))
}

function removePricebook(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'pricebooks', id))
}

function writeContract(userUid: string, c: Contract): Promise<void> {
  return setDoc(docRef(userUid, 'contracts', c.id), stripUndefined(c))
}

function removeContract(userUid: string, id: string): Promise<void> {
  return deleteDoc(docRef(userUid, 'contracts', id))
}

function writeSettings(userUid: string, settings: SettingsDoc): Promise<void> {
  return setDoc(settingsRef(userUid), settings)
}

function writeOrgchart(userUid: string, orgchart: OrgchartDoc): Promise<void> {
  return setDoc(orgchartRef(userUid), orgchart)
}

// ─── Batch write helpers for cross-feature atomicity ─────────────────────────
async function batchWriteTaskAndTimeline(userUid: string, bucketId: string, task: Task, timeline: Timeline) {
  const batch = writeBatch(db)
  batch.set(docRef(userUid, 'tasks', task.id), stripUndefined({ ...task, bucketId }))
  batch.set(docRef(userUid, 'timelines', timeline.id), stripUndefined(timeline))
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

  // Settings (buckets + email only)
  const bucketDefs: Omit<TaskBucket, 'tasks'>[] = (data.taskBuckets ?? []).map(
    ({ id, name, color }) => ({ id, name, color })
  )
  const settings: SettingsDoc = {
    bucketDefs:    bucketDefs.length > 0 ? bucketDefs : DEFAULT_BUCKET_DEFS,
    emailSettings: data.emailSettings ?? {},
  }
  await add(settingsRef(userUid), settings)

  // Org chart (separate document)
  const orgchart: OrgchartDoc = {
    dottedLines:    (data as any).dottedLines    ?? [],
    peerLines:      (data as any).peerLines      ?? [],
    chartContacts:  (data as any).chartContacts  ?? [],
    positions:      (data as any).positions      ?? {},
    activeChartOrg: (data as any).activeChartOrg ?? null,
    savedCharts:    (data as any).savedCharts    ?? [],
  }
  await add(orgchartRef(userUid), orgchart)

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
    contactsReady: false,
    meetingsReady: false,
    tasksReady: false,
    timelinesReady: false,
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
    diagrams: [],
    dealProducts: [],
    deals: [],
    customerConfigs: [],
    pricebooks: [],
    contracts: [],

    setUid: (uid) => {
      collectionsLoaded = 0
      set(s => { s.uid = uid })
    },
    setLoading: (loading) => set(s => { s.loading = loading }),

    // saveUserData is a no-op now — each action writes its own docs.
    // Kept so any component that calls it doesn't break.
    saveUserData: () => {},

    loadUserData: async (userUid) => {
      set(s => {
        s.loading = true
        s.contactsReady = false
        s.meetingsReady = false
        s.tasksReady = false
        s.timelinesReady = false
      })
      collectionsLoaded = 0

      // Run migration from old single-doc format first
      try {
        await migrateIfNeeded(userUid)
      } catch (e) {
        console.warn('[migration] failed (non-fatal):', e)
      }

      const unsubs: Unsubscribe[] = []

      // Track how many subcollections have fired their first snapshot
      // (4 subcollections + settings + orgchart = 6 total)
      const markLoaded = () => {
        collectionsLoaded++
        if (collectionsLoaded >= TOTAL_COLLECTIONS + 2) {
          set(s => { s.loading = false })
        }
      }

      // ── Contacts ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'contacts'), (snap) => {
        const contacts: Contact[] = snap.docs.map(d => d.data() as Contact)
        set(s => { s.contacts = contacts; s.contactsReady = true })
        markLoaded()
      }, (e) => { console.error('[contacts snapshot]', e); set(s => { s.contactsReady = true }); markLoaded() }))

      // ── Meetings ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'meetings'), (snap) => {
        const meetings: Meeting[] = snap.docs.map(d => d.data() as Meeting)
        set(s => { s.meetings = meetings; s.meetingsReady = true })
        markLoaded()
      }, (e) => { console.error('[meetings snapshot]', e); set(s => { s.meetingsReady = true }); markLoaded() }))

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
        set(s => { s.tasksReady = true })
        markLoaded()
      }, (e) => { console.error('[tasks snapshot]', e); set(s => { s.tasksReady = true }); markLoaded() }))

      // ── Timelines ───────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'timelines'), (snap) => {
        const timelines: Timeline[] = snap.docs.map(d => d.data() as Timeline)
        set(s => { s.timelines = timelines; s.timelinesReady = true })
        markLoaded()
      }, (e) => { console.error('[timelines snapshot]', e); set(s => { s.timelinesReady = true }); markLoaded() }))

      // ── Diagrams ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'diagrams'), (snap) => {
        const diagrams: Diagram[] = snap.docs.map(d => d.data() as Diagram)
        set(s => { s.diagrams = diagrams })
        markLoaded()
      }, (e) => { console.error('[diagrams snapshot]', e); markLoaded() }))

      // ── Deal Products ───────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'dealProducts'), (snap) => {
        const dealProducts: DealProduct[] = snap.docs.map(d => d.data() as DealProduct)
        set(s => { s.dealProducts = dealProducts })
        markLoaded()
      }, (e) => { console.error('[dealProducts snapshot]', e); markLoaded() }))

      // ── Deals ────────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'deals'), (snap) => {
        const deals: Deal[] = snap.docs.map(d => d.data() as Deal)
        set(s => { s.deals = deals })
        markLoaded()
      }, (e) => { console.error('[deals snapshot]', e); markLoaded() }))

      // ── Customer Configs ─────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'customerConfigs'), (snap) => {
        const customerConfigs: CustomerConfig[] = snap.docs.map(d => d.data() as CustomerConfig)
        set(s => { s.customerConfigs = customerConfigs })
        markLoaded()
      }, (e) => { console.error('[customerConfigs snapshot]', e); markLoaded() }))

      // ── Pricebooks ───────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'pricebooks'), (snap) => {
        const pricebooks: Pricebook[] = snap.docs.map(d => d.data() as Pricebook)
        set(s => { s.pricebooks = pricebooks })
        markLoaded()
      }, (e) => { console.error('[pricebooks snapshot]', e); markLoaded() }))

      // ── Contracts ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(colRef(userUid, 'contracts'), (snap) => {
        const contracts: Contract[] = snap.docs.map(d => d.data() as Contract)
        set(s => { s.contracts = contracts })
        markLoaded()
      }, (e) => { console.error('[contracts snapshot]', e); markLoaded() }))

      // ── Settings ────────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(settingsRef(userUid), (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<SettingsDoc>
          set(s => {
            if (d.bucketDefs && d.bucketDefs.length > 0) {
              s.taskBuckets = d.bucketDefs.map(def => ({ ...def, tasks: [] }))
            }
            s.emailSettings = d.emailSettings ?? {}
          })
          // Sync FX rate into currency store if present
          if (d.usdToAudRate && d.usdToAudRate > 0) {
            useCurrency.getState().setFxRateDirect(d.usdToAudRate)
          }
          // Re-assign tasks into the now-correct bucket defs
          rebuildTaskBuckets()
        } else {
          // No settings doc yet — write defaults
          writeSettings(userUid, { bucketDefs: DEFAULT_BUCKET_DEFS, emailSettings: {} })
            .catch(e => console.error('[writeSettings default]', e))
        }
        markLoaded()
      }, (e) => { console.error('[settings snapshot]', e); markLoaded() }))

      // ── Org chart ───────────────────────────────────────────────────────────
      unsubs.push(onSnapshot(orgchartRef(userUid), (snap) => {
        if (snap.exists()) {
          const d = snap.data() as Partial<OrgchartDoc>
          set(s => {
            s.dottedLines    = d.dottedLines    ?? []
            s.peerLines      = d.peerLines      ?? []
            s.chartContacts  = d.chartContacts  ?? []
            s.positions      = d.positions      ?? {}
            s.activeChartOrg = d.activeChartOrg ?? null
            s.savedCharts    = d.savedCharts    ?? []
          })
        } else {
          // No orgchart doc yet — write defaults
          writeOrgchart(userUid, { dottedLines: [], peerLines: [], chartContacts: [], positions: {}, activeChartOrg: null, savedCharts: [] })
            .catch(e => console.error('[writeOrgchart default]', e))
        }
        markLoaded()
      }, (e) => { console.error('[orgchart snapshot]', e); markLoaded() }))

      return () => { unsubs.forEach(u => u()) }
    },

    // ── Contacts ──────────────────────────────────────────────────────────────
    addContact: (contact) => {
      set(s => { s.contacts.push(contact) })
      const u = get().uid
      if (u) writeContact(u, contact).catch(e => {
        console.error('[addContact]', e)
        set(s => { s.contacts = s.contacts.filter(c => c.id !== contact.id) })
      })
    },

    updateContact: (contact) => {
      let prev: Contact | undefined
      set(s => {
        const i = s.contacts.findIndex(c => c.id === contact.id)
        if (i >= 0) { prev = { ...s.contacts[i] }; s.contacts[i] = contact }
      })
      const u = get().uid
      if (u) writeContact(u, contact).catch(e => {
        console.error('[updateContact]', e)
        if (prev) set(s => { const i = s.contacts.findIndex(c => c.id === contact.id); if (i >= 0) s.contacts[i] = prev! })
      })
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
        Promise.all([
          removeContact(u, id),
          writeOrgchart(u, buildOrgchartDoc(get())),
        ]).catch(e => console.error('[deleteContact]', e))
      }
    },

    importContacts: (newContacts) => {
      set(s => { newContacts.forEach(c => s.contacts.push(c)) })
      const u = get().uid
      if (!u) return
      const batch = writeBatch(db)
      for (const c of newContacts) batch.set(docRef(u, 'contacts', c.id), c)
      batch.commit().catch(e => {
        console.error('[importContacts]', e)
        const ids = new Set(newContacts.map(c => c.id))
        set(s => { s.contacts = s.contacts.filter(c => !ids.has(c.id)) })
      })
    },

    // ── Org chart ─────────────────────────────────────────────────────────────
    setPositions: (positions) => {
      set(s => { s.positions = positions })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[setPositions]', e))
    },

    setChartContacts: (ids) => {
      set(s => { s.chartContacts = ids })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[setChartContacts]', e))
    },

    setActiveChartOrg: (org) => {
      set(s => { s.activeChartOrg = org })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[setActiveChartOrg]', e))
    },

    addDottedLine: (line) => {
      set(s => { s.dottedLines.push(line) })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[addDottedLine]', e))
    },

    removeDottedLine: (fromId, toId) => {
      set(s => { s.dottedLines = s.dottedLines.filter(d => !(d.fromId === fromId && d.toId === toId)) })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[removeDottedLine]', e))
    },

    addPeerLine: (line) => {
      set(s => { s.peerLines.push(line) })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[addPeerLine]', e))
    },

    removePeerLine: (fromId, toId) => {
      set(s => { s.peerLines = s.peerLines.filter(d => !(d.fromId === fromId && d.toId === toId)) })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[removePeerLine]', e))
    },

    saveChart: (chart) => {
      set(s => { s.savedCharts.push(chart) })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => {
        console.error('[saveChart]', e)
        set(s => { s.savedCharts = s.savedCharts.filter(c => c.id !== chart.id) })
      })
    },

    deleteChart: (id) => {
      let prev: SavedChart | undefined
      set(s => { prev = s.savedCharts.find(c => c.id === id); s.savedCharts = s.savedCharts.filter(c => c.id !== id) })
      const u = get().uid; if (u) writeOrgchart(u, buildOrgchartDoc(get())).catch(e => {
        console.error('[deleteChart]', e)
        if (prev) set(s => { s.savedCharts.push(prev!) })
      })
    },

    // ── Meetings ──────────────────────────────────────────────────────────────
    addMeeting: (meeting) => {
      set(s => { s.meetings.push(meeting) })
      const u = get().uid
      if (u) writeMeeting(u, meeting).catch(e => {
        console.error('[addMeeting]', e)
        set(s => { s.meetings = s.meetings.filter(m => m.id !== meeting.id) })
      })
    },

    updateMeeting: (meeting) => {
      let prev: Meeting | undefined
      set(s => { const i = s.meetings.findIndex(m => m.id === meeting.id); if (i >= 0) { prev = { ...s.meetings[i] }; s.meetings[i] = meeting } })
      const u = get().uid
      if (u) writeMeeting(u, meeting).catch(e => {
        console.error('[updateMeeting]', e)
        if (prev) set(s => { const i = s.meetings.findIndex(m => m.id === meeting.id); if (i >= 0) s.meetings[i] = prev! })
      })
    },

    deleteMeeting: (id) => {
      let prev: Meeting | undefined
      set(s => { prev = s.meetings.find(m => m.id === id); s.meetings = s.meetings.filter(m => m.id !== id) })
      const u = get().uid
      if (u) removeMeeting(u, id).catch(e => {
        console.error('[deleteMeeting]', e)
        if (prev) set(s => { s.meetings.push(prev!) })
      })
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
          batch.set(docRef(u, 'tasks', task.id), stripUndefined({ ...task, bucketId }))
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
      writeSettings(u, buildSettingsDoc(get())).catch(e => console.error('[setTaskBuckets settings]', e))
      // Write all tasks (in case tasks were moved between buckets)
      const batch = writeBatch(db)
      for (const b of buckets) {
        for (const task of b.tasks) {
          batch.set(docRef(u, 'tasks', task.id), stripUndefined({ ...task, bucketId: b.id }))
        }
      }
      batch.commit().catch(e => console.error('[setTaskBuckets batch]', e))
    },

    addTask: (bucketId, task) => {
      set(s => { const b = s.taskBuckets.find(b => b.id === bucketId); if (b) b.tasks.push(task) })
      const u = get().uid
      if (u) writeTask(u, bucketId, task).catch(e => {
        console.error('[addTask]', e)
        set(s => { const b = s.taskBuckets.find(b => b.id === bucketId); if (b) b.tasks = b.tasks.filter(t => t.id !== task.id) })
      })
    },

    updateTask: (bucketId, task) => {
      const isDone = (task.progress ?? 0) >= 100
      let effectiveBucketId = bucketId

      set(s => {
        const doneBucket = s.taskBuckets.find(b => b.id === 'done') ?? s.taskBuckets[s.taskBuckets.length - 1]
        const srcBucket  = s.taskBuckets.find(b => b.id === bucketId)

        if (isDone && doneBucket && srcBucket && doneBucket.id !== bucketId) {
          // Move to done bucket
          if (srcBucket) srcBucket.tasks = srcBucket.tasks.filter(t => t.id !== task.id)
          doneBucket.tasks.push(task)
          effectiveBucketId = doneBucket.id
        } else if (srcBucket) {
          const idx = srcBucket.tasks.findIndex(t => t.id === task.id)
          if (idx >= 0) srcBucket.tasks[idx] = task
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
        if (isDone) {
          s.meetings.forEach(m => {
            m.actionItems.forEach(a => { if (a.taskId === task.id) a.done = true })
          })
        }
      })

      const u = get().uid
      if (!u) return
      writeTask(u, effectiveBucketId, task).catch(e => console.error('[updateTask]', e))
      // Write any timelines that were affected
      const affectedTimelines = get().timelines.filter(tl => tl.items.some(i => i.taskId === task.id))
      affectedTimelines.forEach(tl => writeTimeline(u, tl).catch(e => console.error('[updateTask timeline]', e)))
      // Write any meetings that were affected (if task became done)
      if (isDone) {
        const affectedMeetings = get().meetings.filter(m => m.actionItems.some(a => a.taskId === task.id))
        affectedMeetings.forEach(m => writeMeeting(u, m).catch(e => console.error('[updateTask meeting]', e)))
      }
    },

    deleteTask: (taskId) => {
      let prevTask: Task | undefined
      let prevBucketId: string | undefined
      let affectedTimelineIds: string[] = []
      let affectedMeetingIds: string[] = []

      set(s => {
        // Remove from bucket, remember for potential revert
        for (const b of s.taskBuckets) {
          const idx = b.tasks.findIndex(t => t.id === taskId)
          if (idx >= 0) {
            prevTask = { ...b.tasks[idx] }
            prevBucketId = b.id
            b.tasks.splice(idx, 1)
            break
          }
        }
        // Cascade: null out taskId on linked timeline items
        s.timelines.forEach(tl => {
          tl.items.forEach(item => {
            if (item.taskId === taskId) {
              affectedTimelineIds.push(tl.id)
              delete item.taskId
            }
          })
        })
        // Cascade: null out taskId on linked action items
        s.meetings.forEach(m => {
          m.actionItems.forEach(a => {
            if (a.taskId === taskId) {
              affectedMeetingIds.push(m.id)
              delete a.taskId
            }
          })
        })
      })

      const u = get().uid
      if (!u) return
      const batch = writeBatch(db)
      batch.delete(docRef(u, 'tasks', taskId))
      for (const tlId of affectedTimelineIds) {
        const tl = get().timelines.find(x => x.id === tlId)
        if (tl) batch.set(docRef(u, 'timelines', tl.id), stripUndefined(tl))
      }
      for (const mId of affectedMeetingIds) {
        const m = get().meetings.find(x => x.id === mId)
        if (m) batch.set(docRef(u, 'meetings', m.id), m)
      }
      batch.commit().catch(e => {
        console.error('[deleteTask]', e)
        // Revert: put task back in its bucket
        if (prevTask && prevBucketId) {
          set(s => { const b = s.taskBuckets.find(b => b.id === prevBucketId); if (b) b.tasks.push(prevTask!) })
        }
      })
    },

    moveTask: (taskId, fromBucketId, toBucketId) => {
      let movedTask: Task | null = null
      let meetingsAffected = false
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
            m.actionItems.forEach(a => { if (a.taskId === taskId) { a.done = true; meetingsAffected = true } })
          })
        } else if (fromBucketId === 'done') {
          // Moving back out of done — mark incomplete
          if (task.progress === 100) task.progress = 0
          s.meetings.forEach(m => {
            m.actionItems.forEach(a => { if (a.taskId === taskId) { a.done = false; meetingsAffected = true } })
          })
        }
        toBucket.tasks.push(task)
        movedTask = task
      })
      const u = get().uid
      if (!u || !movedTask) return
      writeTask(u, toBucketId, movedTask).catch(e => console.error('[moveTask]', e))
      if (meetingsAffected) {
        const affectedMeetings = get().meetings.filter(m => m.actionItems.some(a => a.taskId === taskId))
        affectedMeetings.forEach(m => writeMeeting(u, m).catch(e => console.error('[moveTask meeting]', e)))
      }
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    setEmailSettings: (settings) => {
      let prev: EmailSettings | undefined
      set(s => { prev = { ...s.emailSettings }; s.emailSettings = settings })
      const u = get().uid
      if (u) writeSettings(u, buildSettingsDoc(get())).catch(e => {
        console.error('[setEmailSettings]', e)
        if (prev) set(s => { s.emailSettings = prev! })
      })
    },

    saveFxRate: (usdToAudRate) => {
      const u = get().uid
      if (!u) return
      const doc: SettingsDoc = { ...buildSettingsDoc(get()), usdToAudRate }
      writeSettings(u, doc).catch(e => console.error('[saveFxRate]', e))
    },

    // ── Timelines ─────────────────────────────────────────────────────────────
    addTimeline: (t) => {
      set(s => { s.timelines.push(t) })
      const u = get().uid
      if (u) writeTimeline(u, t).catch(e => {
        console.error('[addTimeline]', e)
        set(s => { s.timelines = s.timelines.filter(x => x.id !== t.id) })
      })
    },

    updateTimeline: (t) => {
      let prev: Timeline | undefined
      set(s => { const i = s.timelines.findIndex(x => x.id === t.id); if (i >= 0) { prev = { ...s.timelines[i] }; s.timelines[i] = t } })
      const u = get().uid
      if (u) writeTimeline(u, t).catch(e => {
        console.error('[updateTimeline]', e)
        if (prev) set(s => { const i = s.timelines.findIndex(x => x.id === t.id); if (i >= 0) s.timelines[i] = prev! })
      })
    },

    deleteTimeline: (id) => {
      let prev: Timeline | undefined
      set(s => { prev = s.timelines.find(t => t.id === id); s.timelines = s.timelines.filter(t => t.id !== id) })
      const u = get().uid
      if (u) removeTimeline(u, id).catch(e => {
        console.error('[deleteTimeline]', e)
        if (prev) set(s => { s.timelines.push(prev!) })
      })
    },

    // ── Diagrams ──────────────────────────────────────────────────────────────
    addDiagram: (diagram) => {
      set(s => { s.diagrams.push(diagram) })
      const u = get().uid
      if (u) writeDiagram(u, diagram).catch(e => {
        console.error('[addDiagram]', e)
        set(s => { s.diagrams = s.diagrams.filter(d => d.id !== diagram.id) })
      })
    },

    updateDiagram: (diagram) => {
      let prev: Diagram | undefined
      set(s => { const i = s.diagrams.findIndex(d => d.id === diagram.id); if (i >= 0) { prev = { ...s.diagrams[i] }; s.diagrams[i] = diagram } })
      const u = get().uid
      if (u) writeDiagram(u, diagram).catch(e => {
        console.error('[updateDiagram]', e)
        if (prev) set(s => { const i = s.diagrams.findIndex(d => d.id === diagram.id); if (i >= 0) s.diagrams[i] = prev! })
      })
    },

    deleteDiagram: (id) => {
      let prev: Diagram | undefined
      set(s => { prev = s.diagrams.find(d => d.id === id); s.diagrams = s.diagrams.filter(d => d.id !== id) })
      const u = get().uid
      if (u) removeDiagram(u, id).catch(e => {
        console.error('[deleteDiagram]', e)
        if (prev) set(s => { s.diagrams.push(prev!) })
      })
    },

    // ── Deal Engine — Products ────────────────────────────────────────────────
    addDealProduct: (p) => {
      set(s => { s.dealProducts.push(p) })
      const u = get().uid
      if (u) writeDealProduct(u, p).catch(e => {
        console.error('[addDealProduct]', e)
        set(s => { s.dealProducts = s.dealProducts.filter(x => x.id !== p.id) })
      })
    },

    updateDealProduct: (p) => {
      let prev: DealProduct | undefined
      set(s => { const i = s.dealProducts.findIndex(x => x.id === p.id); if (i >= 0) { prev = { ...s.dealProducts[i] }; s.dealProducts[i] = p } })
      const u = get().uid
      if (u) writeDealProduct(u, p).catch(e => {
        console.error('[updateDealProduct]', e)
        if (prev) set(s => { const i = s.dealProducts.findIndex(x => x.id === p.id); if (i >= 0) s.dealProducts[i] = prev! })
      })
    },

    deleteDealProduct: (id) => {
      let prev: DealProduct | undefined
      set(s => { prev = s.dealProducts.find(x => x.id === id); s.dealProducts = s.dealProducts.filter(x => x.id !== id) })
      const u = get().uid
      if (u) removeDealProduct(u, id).catch(e => {
        console.error('[deleteDealProduct]', e)
        if (prev) set(s => { s.dealProducts.push(prev!) })
      })
    },

    // ── Deal Engine — Deals ───────────────────────────────────────────────────
    addDeal: (d) => {
      set(s => { s.deals.push(d) })
      const u = get().uid
      if (u) writeDeal(u, d).catch(e => {
        console.error('[addDeal]', e)
        set(s => { s.deals = s.deals.filter(x => x.id !== d.id) })
      })
    },

    updateDeal: (d) => {
      let prev: Deal | undefined
      set(s => { const i = s.deals.findIndex(x => x.id === d.id); if (i >= 0) { prev = { ...s.deals[i] }; s.deals[i] = d } })
      const u = get().uid
      if (u) writeDeal(u, d).catch(e => {
        console.error('[updateDeal]', e)
        if (prev) set(s => { const i = s.deals.findIndex(x => x.id === d.id); if (i >= 0) s.deals[i] = prev! })
      })
    },

    deleteDeal: (id) => {
      let prev: Deal | undefined
      set(s => { prev = s.deals.find(x => x.id === id); s.deals = s.deals.filter(x => x.id !== id) })
      const u = get().uid
      if (u) removeDeal(u, id).catch(e => {
        console.error('[deleteDeal]', e)
        if (prev) set(s => { s.deals.push(prev!) })
      })
    },

    // ── Customer Configs ──────────────────────────────────────────────────────
    addCustomerConfig: (c) => {
      set(s => { s.customerConfigs.push(c) })
      const u = get().uid
      if (u) writeCustomerConfig(u, c).catch(e => {
        console.error('[addCustomerConfig]', e)
        set(s => { s.customerConfigs = s.customerConfigs.filter(x => x.id !== c.id) })
      })
    },

    updateCustomerConfig: (c) => {
      let prev: CustomerConfig | undefined
      set(s => { const i = s.customerConfigs.findIndex(x => x.id === c.id); if (i >= 0) { prev = s.customerConfigs[i]; s.customerConfigs[i] = c } })
      const u = get().uid
      if (u) writeCustomerConfig(u, c).catch(e => {
        console.error('[updateCustomerConfig]', e)
        if (prev) set(s => { const i = s.customerConfigs.findIndex(x => x.id === c.id); if (i >= 0) s.customerConfigs[i] = prev! })
      })
    },

    deleteCustomerConfig: (id) => {
      let prev: CustomerConfig | undefined
      set(s => { prev = s.customerConfigs.find(x => x.id === id); s.customerConfigs = s.customerConfigs.filter(x => x.id !== id) })
      const u = get().uid
      if (u) removeCustomerConfig(u, id).catch(e => {
        console.error('[deleteCustomerConfig]', e)
        if (prev) set(s => { s.customerConfigs.push(prev!) })
      })
    },

    // ── Pricebooks ────────────────────────────────────────────────────────────
    addPricebook: (p) => {
      set(s => { s.pricebooks.push(p) })
      const u = get().uid
      if (u) writePricebook(u, p).catch(e => {
        console.error('[addPricebook]', e)
        set(s => { s.pricebooks = s.pricebooks.filter(x => x.id !== p.id) })
      })
    },

    updatePricebook: (p) => {
      let prev: Pricebook | undefined
      set(s => { const i = s.pricebooks.findIndex(x => x.id === p.id); if (i >= 0) { prev = s.pricebooks[i]; s.pricebooks[i] = p } })
      const u = get().uid
      if (u) writePricebook(u, p).catch(e => {
        console.error('[updatePricebook]', e)
        if (prev) set(s => { const i = s.pricebooks.findIndex(x => x.id === p.id); if (i >= 0) s.pricebooks[i] = prev! })
      })
    },

    deletePricebook: (id) => {
      let prev: Pricebook | undefined
      set(s => { prev = s.pricebooks.find(x => x.id === id); s.pricebooks = s.pricebooks.filter(x => x.id !== id) })
      const u = get().uid
      if (u) removePricebook(u, id).catch(e => {
        console.error('[deletePricebook]', e)
        if (prev) set(s => { s.pricebooks.push(prev!) })
      })
    },

    // ── Contracts ─────────────────────────────────────────────────────────────
    addContract: (c) => {
      set(s => { s.contracts.push(c) })
      const u = get().uid
      if (u) writeContract(u, c).catch(e => {
        console.error('[addContract]', e)
        set(s => { s.contracts = s.contracts.filter(x => x.id !== c.id) })
      })
    },

    updateContract: (c) => {
      let prev: Contract | undefined
      set(s => { const i = s.contracts.findIndex(x => x.id === c.id); if (i >= 0) { prev = s.contracts[i]; s.contracts[i] = c } })
      const u = get().uid
      if (u) writeContract(u, c).catch(e => {
        console.error('[updateContract]', e)
        if (prev) set(s => { const i = s.contracts.findIndex(x => x.id === c.id); if (i >= 0) s.contracts[i] = prev! })
      })
    },

    deleteContract: (id) => {
      let prev: Contract | undefined
      set(s => { prev = s.contracts.find(x => x.id === id); s.contracts = s.contracts.filter(x => x.id !== id) })
      const u = get().uid
      if (u) removeContract(u, id).catch(e => {
        console.error('[deleteContract]', e)
        if (prev) set(s => { s.contracts.push(prev!) })
      })
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
      const taskWithSubs   = { ...task, subTasks: subTasks.length > 0 ? subTasks : undefined }
      const itemWithTagged = { ...updatedItem, subItems: taggedSubItems.length > 0 ? taggedSubItems : undefined }

      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        if (bucket) bucket.tasks.push(taskWithSubs)
        const tl = s.timelines.find(x => x.id === timelineId)
        if (tl) {
          const idx = tl.items.findIndex(i => i.id === itemWithTagged.id)
          if (idx >= 0) tl.items[idx] = itemWithTagged
          else tl.items.push(itemWithTagged)
        }
      })
      const u = get().uid
      if (!u) return
      // Read from get() AFTER set() — Immer draft proxies are revoked once set() returns
      const tl = get().timelines.find(x => x.id === timelineId)
      if (tl) batchWriteTaskAndTimeline(u, bucketId, taskWithSubs, tl)
        .catch(e => console.error('[addTaskAndUpdateTimeline batch]', e))
    },

    saveTaskWithTimelineItem: (bucketId, task) => {
      const isDone = (task.progress ?? 0) >= 100
      let affectedTimelineId: string | null = null
      let effectiveBucketId = bucketId
      set(s => {
        const doneBucket = s.taskBuckets.find(b => b.id === 'done') ?? s.taskBuckets[s.taskBuckets.length - 1]
        const targetId = isDone && doneBucket ? doneBucket.id : bucketId
        effectiveBucketId = targetId

        // Remove from source bucket if moving to done
        if (isDone && doneBucket && doneBucket.id !== bucketId) {
          const srcBucket = s.taskBuckets.find(b => b.id === bucketId)
          if (srcBucket) srcBucket.tasks = srcBucket.tasks.filter(t => t.id !== task.id)
        }

        const bucket = s.taskBuckets.find(b => b.id === targetId)
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
                id: uid(),
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
            affectedTimelineId = tl.id  // store id only — proxy is revoked after set()
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
      if (affectedTimelineId) {
        // Read fresh (non-draft) timeline from state after set() has committed
        const tl = get().timelines.find(x => x.id === affectedTimelineId)
        if (tl) batchWriteTaskAndTimeline(u, effectiveBucketId, task, tl)
          .catch(e => console.error('[saveTaskWithTimelineItem batch]', e))
      } else {
        writeTask(u, effectiveBucketId, task).catch(e => console.error('[saveTaskWithTimelineItem]', e))
        get().timelines.filter(tl => tl.items.some(i => i.taskId === task.id))
          .forEach(tl => writeTimeline(u, tl).catch(e => console.error('[saveTaskWithTimelineItem timeline]', e)))
      }
    },

    saveSubTaskWithTimelineSync: (bucketId, parentTaskId, sub, subItemId) => {
      let affectedTimelineId: string | null = null

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
            affectedTimelineId = tl.id  // id only — proxy revoked after set()
            break
          }
        }
      })

      const u = get().uid
      if (!u) return
      // Read fresh state after set() — drafts are revoked
      const task = get().taskBuckets.find(b => b.id === bucketId)?.tasks.find(t => t.id === parentTaskId)
      if (task && affectedTimelineId) {
        const tl = get().timelines.find(x => x.id === affectedTimelineId)
        if (tl) batchWriteTaskAndTimeline(u, bucketId, task, tl)
          .catch(e => console.error('[saveSubTaskWithTimelineSync batch]', e))
      } else if (task) {
        writeTask(u, bucketId, task)
      }
    },

    deleteSubTaskWithTimelineSync: (bucketId, parentTaskId, subId) => {
      let affectedTimelineId: string | null = null

      set(s => {
        const bucket = s.taskBuckets.find(b => b.id === bucketId)
        const task = bucket?.tasks.find(t => t.id === parentTaskId)
        if (task) {
          task.subTasks = (task.subTasks ?? []).filter(st => st.id !== subId)
          const span = subtaskDateSpan(task.subTasks ?? [])
          if (span.startDate) task.startDate = span.startDate
          if (span.due)       task.due        = span.due
        }

        for (const tl of s.timelines) {
          const item = tl.items.find(i => i.taskId === parentTaskId)
          if (item) {
            item.subItems = (item.subItems ?? []).filter(si => si.id !== subId && si.subTaskId !== subId)
            const allStarts = (item.subItems ?? []).map(si => si.startDate).filter(Boolean) as string[]
            const allEnds   = (item.subItems ?? []).map(si => si.endDate).filter(Boolean) as string[]
            if (allStarts.length) item.startDate = allStarts.reduce((a, b) => a < b ? a : b)
            if (allEnds.length)   item.endDate   = allEnds.reduce((a, b) => a > b ? a : b)
            affectedTimelineId = tl.id
            break
          }
        }
      })

      const u = get().uid
      if (!u) return
      const task = get().taskBuckets.find(b => b.id === bucketId)?.tasks.find(t => t.id === parentTaskId)
      if (task && affectedTimelineId) {
        const tl = get().timelines.find(x => x.id === affectedTimelineId)
        if (tl) batchWriteTaskAndTimeline(u, bucketId, task, tl)
          .catch(e => console.error('[deleteSubTaskWithTimelineSync batch]', e))
      } else if (task) {
        writeTask(u, bucketId, task)
      }
    },

    syncBarSubItemsToTask: (updatedItem) => {
      if (!updatedItem.taskId || !updatedItem.subItems?.length) return
      let affectedBucketId: string | null = null
      let affectedTimelineId: string | null = null

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
            affectedTimelineId = tl.id
            break
          }
        }
      })

      const u = get().uid
      if (!u || !affectedBucketId) return
      // Read fresh state after set() — Immer drafts are revoked
      const task = get().taskBuckets.find(b => b.id === affectedBucketId)?.tasks.find(t => t.id === updatedItem.taskId)
      if (!task) return
      if (affectedTimelineId) {
        const tl = get().timelines.find(x => x.id === affectedTimelineId)
        if (tl) batchWriteTaskAndTimeline(u, affectedBucketId, task, tl)
          .catch(e => console.error('[syncBarSubItemsToTask batch]', e))
      } else {
        writeTask(u, affectedBucketId, task)
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
        for (const task of tasks) batch.set(docRef(u, 'tasks', task.id), stripUndefined({ ...task, bucketId }))
      }
      batch.set(docRef(u, 'timelines', demoTimeline.id), demoTimeline)
      batch.commit().catch(e => console.error('[loadDemoData batch]', e))
      writeSettings(u, buildSettingsDoc(get())).catch(e => console.error('[loadDemoData settings]', e))
      writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[loadDemoData orgchart]', e))
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
      writeSettings(u, buildSettingsDoc(get())).catch(e => console.error('[clearDemoData settings]', e))
      writeOrgchart(u, buildOrgchartDoc(get())).catch(e => console.error('[clearDemoData orgchart]', e))
    },
  }))
)

// ─── Settings doc builder ─────────────────────────────────────────────────────
function buildSettingsDoc(state: StoreState): SettingsDoc {
  return {
    bucketDefs:    state.taskBuckets.map(({ id, name, color }) => ({ id, name, color })),
    emailSettings: state.emailSettings,
    usdToAudRate:  useCurrency.getState().usdToAudRate,
  }
}

// ─── Org chart doc builder ────────────────────────────────────────────────────
function buildOrgchartDoc(state: StoreState): OrgchartDoc {
  return {
    dottedLines:    state.dottedLines,
    peerLines:      state.peerLines,
    chartContacts:  state.chartContacts,
    positions:      state.positions,
    activeChartOrg: state.activeChartOrg,
    savedCharts:    state.savedCharts,
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
