export type Level =
  | 'c-level' | 'gm' | 'head-of' | 'director'
  | 'manager' | 'lead' | 'individual'

export interface Contact {
  id: string
  name: string
  title?: string
  org?: string
  level?: Level
  email?: string
  phone?: string
  parentId?: string
  createdAt: number
}

export interface DottedLine {
  fromId: string
  toId: string
}

export interface PeerLine {
  fromId: string
  toId: string
}

export interface Position {
  x: number
  y: number
}

export interface SavedChart {
  id: string
  name: string
  savedAt: string
  contacts: Contact[]
  dottedLines: DottedLine[]
  peerLines: PeerLine[]
  chartContacts: string[]
  positions: Record<string, Position>
}

export interface ActionItem {
  id: string
  text: string
  done: boolean
  assignee?: string
  priority?: 'low' | 'medium' | 'high'
  due?: string
  taskId?: string
}

export interface Meeting {
  id: string
  title: string
  date: string
  attendees: string[]
  discussion?: string
  actionItems: ActionItem[]
  createdAt: number
}

export interface Task {
  id: string
  text: string
  priority?: 'low' | 'medium' | 'high'
  due?: string
  notes?: string
  progress?: number   // 0–100
  createdAt: number
}

export interface TaskBucket {
  id: string
  name: string
  color: string
  tasks: Task[]
}

export interface EmailSettings {
  smtpHost?: string
  smtpPort?: string
  smtpUser?: string
  smtpPass?: string
  fromName?: string
  fromEmail?: string
}

// ─── Timelines ────────────────────────────────────────────────────────────────

export type Timescale = 'days' | 'weeks' | 'months' | 'quarters' | 'years'
export type SubTimescale = 'days' | 'weeks' | 'months' | 'quarters' | null
export type YearMode = 'calendar' | 'financial'  // financial = Jul–Jun (AU)

export interface TimelineMilestone {
  id: string
  label: string
  date: string
  color: string
}

export interface SwimLane {
  id: string
  label: string
  color: string
  collapsed?: boolean
  category?: string
}

export interface TimelineSubItem {
  id: string
  label: string
  startDate: string
  endDate: string
  progress: number
  taskId?: string   // linked Task id
  done?: boolean
}

export interface TimelineItem {
  id: string
  swimLaneId: string
  label: string
  type: 'bar' | 'milestone'
  startDate: string
  endDate: string
  color: string
  progress: number   // 0–100
  notes?: string
  taskId?: string    // linked Task id
  subItems?: TimelineSubItem[]
  collapsed?: boolean
}

export interface Timeline {
  id: string
  name: string
  createdAt: number
  timescale: Timescale
  subTimescale: SubTimescale
  yearMode?: YearMode
  labelWidth?: number   // resizable, default 140
  startDate: string
  endDate: string
  swimLanes: SwimLane[]
  items: TimelineItem[]
  milestones: TimelineMilestone[]
}

// ─── App State ────────────────────────────────────────────────────────────────

export interface AppState {
  contacts: Contact[]
  meetings: Meeting[]
  dottedLines: DottedLine[]
  peerLines: PeerLine[]
  chartContacts: string[]
  positions: Record<string, Position>
  activeChartOrg: string | null
  taskBuckets: TaskBucket[]
  savedCharts: SavedChart[]
  emailSettings: EmailSettings
  timelines: Timeline[]
}
