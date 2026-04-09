import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  doc, setDoc, onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { AppState, Contact, Meeting, TaskBucket, SavedChart, DottedLine, PeerLine, Position, EmailSettings } from '../types'

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

  // Settings
  setEmailSettings: (settings: EmailSettings) => void
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

    setUid: (uid) => set(s => { s.uid = uid }),
    setLoading: (loading) => set(s => { s.loading = loading }),

    loadUserData: async (uid) => {
      set(s => { s.loading = true })

      // Real-time listener on user doc
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
            s.loading = false
          })
        } else {
          // First time user — create their doc with defaults
          setDoc(userRef, {
            contacts: [], meetings: [], dottedLines: [], peerLines: [],
            chartContacts: [], positions: {}, activeChartOrg: null,
            taskBuckets: DEFAULT_BUCKETS, savedCharts: [], emailSettings: {},
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
              positions, activeChartOrg, taskBuckets, savedCharts, emailSettings } = get()
      await setDoc(doc(db, 'users', uid), {
        contacts, meetings, dottedLines, peerLines, chartContacts,
        positions, activeChartOrg, taskBuckets, savedCharts, emailSettings,
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
    setEmailSettings: (settings) => { set(s => { s.emailSettings = settings }); get().saveUserData() },
  }))
)
