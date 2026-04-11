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
  isAssistant?: boolean
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
  contactIds: string[]   // IDs only — resolved against live contacts[] at render time
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

export interface SubTask {
  id: string
  text: string
  priority?: 'low' | 'medium' | 'high'
  startDate?: string       // YYYY-MM-DD
  due?: string             // YYYY-MM-DD end / due date
  notes?: string
  progress?: number       // 0–100
  done?: boolean
  predecessorIds?: string[]  // ids of SubTask or Task that must precede this
}

export interface Task {
  id: string
  text: string
  priority?: 'low' | 'medium' | 'high'
  startDate?: string       // YYYY-MM-DD, defaults to today
  due?: string             // YYYY-MM-DD end / due date
  notes?: string
  progress?: number       // 0–100
  createdAt: number
  subTasks?: SubTask[]
  collapsed?: boolean
  predecessorIds?: string[]  // ids of other Tasks
  timelineId?: string        // linked timeline id
  swimLaneId?: string        // linked swim lane id within that timeline
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
  taskId?: string        // linked Task id
  subTaskId?: string     // linked SubTask id
  done?: boolean
  predecessorIds?: string[]  // other TimelineSubItem ids
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
  predecessorIds?: string[]  // other TimelineItem ids
}

export interface FreezePeriod {
  id: string
  label: string
  startDate: string
  endDate: string
  color: string
}

export interface Timeline {
  id: string
  name: string
  createdAt: number
  timescale: Timescale
  subTimescale: SubTimescale
  yearMode?: YearMode
  labelWidth?: number   // resizable, default 140
  headerMode?: 'single' | 'double'   // double shows major period above minor ticks
  showWeekends?: boolean              // days timescale: hide Sat/Sun columns when false, default true
  weekLabels?: 'range' | 'number'    // weeks timescale: show date range or week number, default 'range'
  colWidth?: number                  // uniform px-per-day override (null = use PX_PER_DAY default)
  colWidthMap?: Record<string, number> // per-column override keyed by YYYY-MM-DD of column start
  startDate: string
  endDate: string
  swimLanes: SwimLane[]
  items: TimelineItem[]
  milestones: TimelineMilestone[]
  freezePeriods?: FreezePeriod[]
}

// ─── Diagrams ─────────────────────────────────────────────────────────────────

export interface Diagram {
  id: string
  name: string
  xml: string          // draw.io XML content
  createdAt: number
  updatedAt: number
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
  diagrams: Diagram[]
}
