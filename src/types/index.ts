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

// ─── Deal Engine ──────────────────────────────────────────────────────────────

export type ProductCategory =
  | 'Software' | 'Hardware' | 'Professional Services'
  | 'Technical Services' | 'Maintenance'

export type FreightMethod = 'ocean' | 'air' | 'mixed'
export type LineItemStatus = 'paid' | 'discounted' | 'free'
export type DiscountType = 'percent' | 'fixed'
export type OptimizationGoal = 'margin' | 'perceived-value'

export interface PricingTier {
  minQty: number
  maxQty: number | null   // null = unlimited
  discountPercent: number
}

export type PricingType = 'one-time' | 'recurring'
export type RecurringPeriod = 'monthly' | 'annual'

export interface RecurringConfig {
  period: RecurringPeriod       // monthly or annual billing
  termMonths: number            // contract term length in months, e.g. 36
  pricePerPeriod: number        // USD per billing period
  floorPricePerPeriod: number   // USD floor per billing period
}

export interface PriceHistoryEntry {
  id: string
  savedAt: number                // Unix ms
  costPrice: number
  floorSellPrice: number
  defaultSellPrice: number
  note?: string                  // e.g. "Initial" or free-text
}

// ─── Product Configurations ───────────────────────────────────────────────────

export type ConfigRowUnit = 'one time' | 'months' | 'years' | 'per unit' | 'per site' | 'per user'

export interface ConfigRow {
  id: string
  productId?: string            // optional link to a DealProduct
  productCode?: string          // e.g. "7371-1203-2000"
  description: string
  quantity: number
  costPriceUsd: number
  floorPriceUsd: number
  sellPriceUsd: number
  unit: ConfigRowUnit
  termMonths?: number           // recurring: contract term in months
  notes?: string
}

export interface ConfigGroup {
  id: string
  label: string                 // e.g. "7371-1203-2000" or "R7 CASH"
  description?: string
  collapsed: boolean
  rows: ConfigRow[]
  subGroups: ConfigGroup[]      // recursive — subgroups within this group
}

export interface ProductConfiguration {
  id: string
  name: string                  // e.g. "R7 CASH", "Standard Package"
  currency: 'USD' | 'AUD'      // the currency prices are entered in (display only)
  notes?: string
  groups: ConfigGroup[]         // top-level groups
  createdAt: number
  updatedAt: number
}

export interface DealProduct {
  id: string
  name: string
  category: ProductCategory
  pricingType: PricingType      // one-time or recurring
  costPrice: number             // USD
  floorSellPrice: number        // USD — hard minimum sell price (one-time / total)
  defaultSellPrice: number      // USD (one-time or total contract value)
  recurringConfig?: RecurringConfig  // populated when pricingType = 'recurring'
  fxOverride?: number           // USD→AUD override (undefined = use deal-level global)
  pricingTiers?: PricingTier[]
  priceHistory?: PriceHistoryEntry[]
  configurations?: ProductConfiguration[]
  createdAt: number
}

export interface FreightConfig {
  method: FreightMethod
  oceanCostPerUnit?: number   // USD per unit
  airCostPerUnit?: number     // USD per unit
  oceanQty?: number           // units via ocean (mixed only)
  airQty?: number             // units via air (mixed only)
}

export interface DealLineItem {
  id: string
  productId: string
  quantity: number
  sellPriceUsd: number        // per unit, user-proposed
  status: LineItemStatus
  discountType?: DiscountType
  discountValue?: number      // % or $ per type
  freight?: FreightConfig
  notes?: string
}

export interface DiscountRule {
  id: string
  type: 'direct' | 'volume-units' | 'volume-value' | 'category' | 'conditional'
  discountType: DiscountType
  discountValue: number
  threshold?: number          // volume-units: qty; volume-value: $ total
  category?: ProductCategory  // category rules only
  ifProductId?: string        // conditional: trigger product
  thenProductId?: string      // conditional: target product
  label?: string
}

export interface DealScenario {
  id: string
  label: string               // "Scenario A", "Scenario B", etc.
  lineItems: DealLineItem[]
  discountRules: DiscountRule[]
  discountBudgetUsd: number
}

export interface Deal {
  id: string
  name: string
  lineItems: DealLineItem[]
  discountRules: DiscountRule[]
  discountBudgetUsd: number
  globalFxRate: number        // USD→AUD
  scenarios: DealScenario[]
  notes?: string
  createdAt: number
  updatedAt: number
}

// Computed at runtime — never stored in Firestore
export interface LineMetrics {
  lineItemId: string
  costUsd: number             // costPrice × qty
  freightCostUsd: number      // total freight for this line
  totalCostUsd: number        // costUsd + freightCostUsd
  listPriceUsd: number        // defaultSellPrice × qty (before any discount)
  sellPriceUsd: number        // actual sell × qty
  discountUsd: number         // listPrice - sellPrice
  marginUsd: number           // sellPrice - totalCost
  marginPercent: number       // marginUsd / sellPriceUsd × 100
  belowFloor: boolean
  perceivedValueUsd: number   // listPrice × qty (customer perceived saving basis)
  costAud: number
  sellAud: number
}

export interface DealMetrics {
  lines: LineMetrics[]
  totalCostUsd: number
  totalFreightUsd: number
  totalSellUsd: number
  totalMarginUsd: number
  totalMarginPercent: number
  totalListValueUsd: number   // what customer would pay at full list
  totalDiscountUsd: number
  totalFreeValueUsd: number   // list value of gratis items
  perceivedSavingsPercent: number
  discountBudgetUsed: number
  discountBudgetRemaining: number
  hasFloorViolation: boolean
  violatingLineIds: string[]
  totalSellAud: number
  totalCostAud: number
}

export interface OptimizationRecommendation {
  type: 'switch-to-ocean' | 'switch-to-air' | 'give-free-units' | 'apply-discount'
      | 'reduce-discount' | 'adjust-sell-price'
  lineItemId: string
  description: string
  why: string
  marginImpactUsd: number     // positive = margin improves
  perceivedValueImpactUsd: number
  priority: 'high' | 'medium' | 'low'
}

export interface OptimizationResult {
  goal: OptimizationGoal
  recommendations: OptimizationRecommendation[]
  projectedMetrics: DealMetrics
  summary: string
}

// ─── Customer Configs ─────────────────────────────────────────────────────────

export interface CustomerConfigItem {
  id: string
  productId: string    // reference to a DealProduct id (or free-text if no match)
  productName: string  // display name — kept in sync or entered manually
  description: string
  quantity: number
  notes?: string
}

export interface CustomerConfig {
  id: string
  customerName: string
  notes?: string
  items: CustomerConfigItem[]
  createdAt: number
  updatedAt: number
}

// ─── Pricebook ────────────────────────────────────────────────────────────────

export type UpliftType = 'none' | 'cpi' | 'fixed'

export interface UpliftConfig {
  type: UpliftType
  percentage: number        // e.g. 3.5 for 3.5%
  label?: string            // e.g. "CPI", "Annual uplift"
  applyAnnually: boolean    // true = applied each year of term
}

export interface PricebookEntry {
  id: string
  productId: string    // reference to DealProduct
  productName: string  // snapshot at time of entry
  unitPriceUsd: number
  customFxRate?: number          // USD→AUD override for this entry
  freightIncluded: boolean
  specialTerms?: string[]        // array of individual term lines
  uplift?: UpliftConfig          // optional per-entry uplift override
}

export interface Pricebook {
  id: string
  customerName: string
  customFxRate?: number          // default USD→AUD for this pricebook
  notes?: string
  validFrom?: string             // YYYY-MM-DD — inclusive start of validity window
  validTo?: string               // YYYY-MM-DD — inclusive end of validity window
  defaultUplift?: UpliftConfig   // default uplift applied to all entries
  entries: PricebookEntry[]
  createdAt: number
  updatedAt: number
}

// ─── Contract Manager ─────────────────────────────────────────────────────────

export type ContractType = 'master-agreement' | 'sow' | 'amendment' | 'renewal'
export type PaymentTerms = 'net-30' | 'net-60' | 'net-90' | 'upfront' | 'milestone' | 'custom'
export type BillingModel  = 'subscription' | 'one-time' | 'mixed'

export interface ContractNotification {
  id: string
  label: string    // e.g. "Renewal Notice", "Contract Ending"
  date: string     // YYYY-MM-DD
  notified: boolean
}

export interface Contract {
  id: string
  contractNumber: string
  type: ContractType
  customerName: string
  title: string
  startDate: string          // YYYY-MM-DD
  endDate: string            // YYYY-MM-DD
  contractValueUsd: number
  billingModel: BillingModel
  paymentTerms: PaymentTerms
  customPaymentTerms?: string  // when paymentTerms = 'custom'
  specialTerms?: string
  notifications: ContractNotification[]
  notes?: string
  parentContractId?: string  // SOWs link back to their master agreement
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
  dealProducts: DealProduct[]
  deals: Deal[]
  customerConfigs: CustomerConfig[]
  pricebooks: Pricebook[]
  contracts: Contract[]
}
