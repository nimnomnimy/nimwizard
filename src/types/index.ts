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
}
