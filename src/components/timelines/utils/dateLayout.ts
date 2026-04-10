import type { Timescale, SubTimescale, YearMode } from '../../../types'

// ─── Date arithmetic helpers ──────────────────────────────────────────────────

export function parseDate(s: string): Date {
  // Parse as local date (not UTC) to avoid timezone shifts
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function startOfWeek(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay() // 0=Sun
  r.setDate(r.getDate() - day)
  return r
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1)
}

export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0)
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

// ─── Column (tick) generation ─────────────────────────────────────────────────

export interface DateColumn {
  label: string
  startDate: Date
  endDate: Date   // exclusive
  widthPx: number
}

/** Width in pixels per day for each timescale */
export const PX_PER_DAY: Record<Timescale, number> = {
  days:     48,
  weeks:    14,
  months:    6,
  quarters:  3,
  years:     1.5,
}

export function getColumns(
  viewStart: Date,
  viewEnd: Date,
  timescale: Timescale,
  subTimescale: SubTimescale,
  yearMode: YearMode = 'calendar',
): { major: DateColumn[]; minor: DateColumn[] | null } {
  const pxPerDay = PX_PER_DAY[timescale]

  const major = buildColumns(viewStart, viewEnd, timescale, pxPerDay, yearMode)
  const minor = subTimescale ? buildColumns(viewStart, viewEnd, subTimescale, pxPerDay, yearMode) : null

  return { major, minor }
}

function buildColumns(
  viewStart: Date,
  viewEnd: Date,
  scale: Timescale | NonNullable<SubTimescale>,
  pxPerDay: number,
  yearMode: YearMode = 'calendar',
): DateColumn[] {
  const cols: DateColumn[] = []
  let cur = bucketStart(viewStart, scale)

  while (cur < viewEnd) {
    const next = bucketNext(cur, scale)
    const clampedStart = cur < viewStart ? viewStart : cur
    const clampedEnd   = next > viewEnd   ? viewEnd   : next
    const days = diffDays(clampedStart, clampedEnd)
    cols.push({
      label: formatLabel(cur, scale, yearMode),
      startDate: clampedStart,
      endDate: clampedEnd,
      widthPx: days * pxPerDay,
    })
    cur = next
  }
  return cols
}

function bucketStart(d: Date, scale: Timescale | NonNullable<SubTimescale>): Date {
  switch (scale) {
    case 'days':     return new Date(d.getFullYear(), d.getMonth(), d.getDate())
    case 'weeks':    return startOfWeek(d)
    case 'months':   return startOfMonth(d)
    case 'quarters': return startOfQuarter(d)
    case 'years':    return startOfYear(d)
  }
}

function bucketNext(d: Date, scale: Timescale | NonNullable<SubTimescale>): Date {
  switch (scale) {
    case 'days':     return addDays(d, 1)
    case 'weeks':    return addDays(d, 7)
    case 'months': {
      const r = new Date(d)
      r.setMonth(r.getMonth() + 1)
      return r
    }
    case 'quarters': {
      const r = new Date(d)
      r.setMonth(r.getMonth() + 3)
      return r
    }
    case 'years': {
      const r = new Date(d)
      r.setFullYear(r.getFullYear() + 1)
      return r
    }
  }
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Financial year starts July 1 (AU). FY2025 = Jul 2024 – Jun 2025.
export function fyYear(d: Date): number {
  return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear()
}
export function fyQuarter(d: Date): number {
  // FY quarters: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
  const m = d.getMonth()
  if (m >= 6 && m <= 8)  return 1
  if (m >= 9 && m <= 11) return 2
  if (m >= 0 && m <= 2)  return 3
  return 4
}

/** Top-row group label for a given major column's start date.
 *  days   → "Jan 2025"  (shown above individual day numbers)
 *  weeks  → "January 2025"  (shown above week columns)
 *  months → "Q1 · Jan–Mar" / "FYQ1 · Jul–Sep"
 *  quarters → "2025" / "FY2025"
 *  years  → "Jan–Dec 2025" / "Jul–Jun FY2025"
 */
export function getGroupLabel(
  d: Date,
  timescale: Timescale,
  yearMode: YearMode = 'calendar',
): string {
  switch (timescale) {
    case 'days':
      return `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`
    case 'weeks':
      return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`
    case 'months': {
      const q = Math.floor(d.getMonth() / 3)
      const fyq = fyQuarter(d)
      const qStart = yearMode === 'financial'
        ? [6, 9, 0, 3][fyq - 1]   // Jul,Oct,Jan,Apr (0-indexed months)
        : q * 3
      const qEnd = (qStart + 2 + 12) % 12
      if (yearMode === 'financial') {
        return `FYQ${fyq} · ${MONTH_SHORT[qStart]}–${MONTH_SHORT[qEnd]}`
      }
      const qLabel = `Q${q + 1}`
      const startM = q * 3
      const endM   = startM + 2
      return `${qLabel} · ${MONTH_SHORT[startM]}–${MONTH_SHORT[endM]}`
    }
    case 'quarters':
      return yearMode === 'financial' ? `FY${fyYear(d)}` : String(d.getFullYear())
    case 'years': {
      if (yearMode === 'financial') {
        const fy = fyYear(d)
        return `FY${fy} · Jul–Jun`
      }
      return `${d.getFullYear()} · Jan–Dec`
    }
  }
}

/** Group key used to bucket adjacent major columns under the same top-row label */
export function getGroupKey(d: Date, timescale: Timescale, yearMode: YearMode = 'calendar'): string {
  switch (timescale) {
    case 'days':
    case 'weeks':
      return `${d.getFullYear()}-${d.getMonth()}`
    case 'months': {
      const q = Math.floor(d.getMonth() / 3)
      if (yearMode === 'financial') return `${fyYear(d)}-${fyQuarter(d)}`
      return `${d.getFullYear()}-Q${q}`
    }
    case 'quarters':
      return yearMode === 'financial' ? `FY${fyYear(d)}` : String(d.getFullYear())
    case 'years':
      return yearMode === 'financial' ? `FY${fyYear(d)}` : String(d.getFullYear())
  }
}

function formatLabel(d: Date, scale: Timescale | NonNullable<SubTimescale>, yearMode: YearMode = 'calendar'): string {
  switch (scale) {
    case 'days':     return String(d.getDate())
    case 'weeks':    return `W${isoWeek(d)}`
    case 'months':   return MONTH_SHORT[d.getMonth()]
    case 'quarters':
      if (yearMode === 'financial') return `FYQ${fyQuarter(d)}`
      return `Q${Math.floor(d.getMonth() / 3) + 1}`
    case 'years':
      if (yearMode === 'financial') return `FY${fyYear(d)}`
      return String(d.getFullYear())
  }
}

function isoWeek(d: Date): number {
  const jan1 = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86_400_000 + jan1.getDay() + 1) / 7)
}

// ─── Position helpers ─────────────────────────────────────────────────────────

/** Convert a date to an x pixel offset from the view start */
export function dateToPx(date: Date, viewStart: Date, timescale: Timescale): number {
  return diffDays(viewStart, date) * PX_PER_DAY[timescale]
}

/** Convert a pixel offset back to a date */
export function pxToDate(px: number, viewStart: Date, timescale: Timescale): Date {
  const days = Math.round(px / PX_PER_DAY[timescale])
  return addDays(viewStart, days)
}

/** Snap a date to the nearest bucket boundary for the given scale */
export function snapDate(d: Date, timescale: Timescale): Date {
  return bucketStart(d, timescale)
}

// ─── Default view range helper ────────────────────────────────────────────────

/** Return a sensible default view range for a new timeline */
export function defaultViewRange(timescale: Timescale): { startDate: string; endDate: string } {
  const today = new Date()
  let start: Date, end: Date

  switch (timescale) {
    case 'days':
      start = addDays(today, -3)
      end   = addDays(today, 28)
      break
    case 'weeks':
      start = startOfWeek(addDays(today, -7))
      end   = addDays(start, 12 * 7)
      break
    case 'months':
      start = startOfMonth(today)
      end   = new Date(today.getFullYear(), today.getMonth() + 9, 1)
      break
    case 'quarters':
      start = startOfQuarter(today)
      end   = new Date(today.getFullYear() + 2, today.getMonth(), 1)
      break
    case 'years':
      start = startOfYear(today)
      end   = startOfYear(new Date(today.getFullYear() + 4, 0, 1))
      break
  }

  return { startDate: formatDate(start), endDate: formatDate(end) }
}

export { MONTH_SHORT, MONTH_LONG }
