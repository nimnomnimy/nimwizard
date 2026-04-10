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

// ─── New header row system ────────────────────────────────────────────────────

export interface WeekendCol { startPx: number; widthPx: number }

export interface HeaderRows {
  topRow: DateColumn[]
  midRow: DateColumn[]
  weekendCols?: WeekendCol[]
}

const DAY_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT']

/** Format a date as "D MMM" e.g. "4 APR" */
function fmtDMon(d: Date): string {
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()].toUpperCase()}`
}

/**
 * Build the two header rows (topRow + midRow) plus optional weekend columns
 * for the given timescale, replacing the old major/tickCols/dblGroups system.
 */
export function getHeaderRows(
  viewStart: Date,
  viewEnd: Date,
  timescale: Timescale,
  yearMode: YearMode = 'calendar',
  opts: { showWeekends?: boolean; weekLabels?: 'range' | 'number' } = {},
): HeaderRows {
  const showWeekends = opts.showWeekends ?? true
  const weekLabels   = opts.weekLabels   ?? 'range'

  switch (timescale) {

    // ── Days ──────────────────────────────────────────────────────────────────
    case 'days': {
      const pxDay = PX_PER_DAY.days
      const midRow: DateColumn[] = []
      const weekendCols: WeekendCol[] = []

      // Walk days in view
      let cur = new Date(viewStart.getFullYear(), viewStart.getMonth(), viewStart.getDate())
      let pxOffset = 0  // offset from viewStart in px (only counting visible columns)

      while (cur < viewEnd) {
        const dow = cur.getDay()  // 0=Sun,6=Sat
        const isWeekend = dow === 0 || dow === 6

        if (!showWeekends && isWeekend) {
          cur = addDays(cur, 1)
          continue
        }

        const dayPx = dateToPxRaw(cur, viewStart, pxDay)  // raw offset ignoring weekend hiding
        if (isWeekend) {
          weekendCols.push({ startPx: dayPx, widthPx: pxDay })
        }

        const next = addDays(cur, 1)
        midRow.push({
          label: `${DAY_SHORT[dow]} ${cur.getDate()}`,
          startDate: new Date(cur),
          endDate: next,
          widthPx: pxDay,
        })
        pxOffset += pxDay
        cur = next
      }

      // Build topRow: group consecutive days by month
      const topRow = groupIntoMonths(midRow, yearMode, showWeekends, viewStart, viewEnd, pxDay)

      return { topRow, midRow, weekendCols }
    }

    // ── Weeks ─────────────────────────────────────────────────────────────────
    case 'weeks': {
      const pxDay = PX_PER_DAY.weeks
      const pxWeek = 7 * pxDay
      const midRow: DateColumn[] = []

      let cur = startOfWeek(viewStart)
      while (cur < viewEnd) {
        const weekEnd = addDays(cur, 7)
        const dispStart = cur < viewStart ? viewStart : cur
        const dispEnd   = weekEnd > viewEnd ? viewEnd : weekEnd

        let label: string
        if (weekLabels === 'number') {
          label = `W${isoWeek(cur)}`
        } else {
          const rangeEnd = addDays(cur, 6)
          label = `${fmtDMon(cur)} – ${fmtDMon(rangeEnd)}`
        }

        midRow.push({
          label,
          startDate: dispStart,
          endDate: dispEnd,
          widthPx: pxWeek,
        })
        cur = weekEnd
      }

      // topRow: group weeks by the month their start date falls in
      const topRow = groupWeeksByMonth(midRow, yearMode)

      return { topRow, midRow }
    }

    // ── Months ────────────────────────────────────────────────────────────────
    case 'months': {
      const pxDay = PX_PER_DAY.months
      const pxWeek = 7 * pxDay
      const midRow: DateColumn[] = []

      // midRow: week start dates within the view
      let cur = startOfWeek(viewStart)
      while (cur < viewEnd) {
        const weekEnd = addDays(cur, 7)
        const dispStart = cur < viewStart ? viewStart : cur
        const dispEnd   = weekEnd > viewEnd ? viewEnd : weekEnd
        midRow.push({
          label: fmtDMon(dispStart),
          startDate: dispStart,
          endDate: dispEnd,
          widthPx: pxWeek,
        })
        cur = weekEnd
      }

      // topRow: one entry per month
      const topRow = groupWeeksByMonth(midRow, yearMode)

      return { topRow, midRow }
    }

    // ── Quarters ──────────────────────────────────────────────────────────────
    case 'quarters': {
      const pxDay = PX_PER_DAY.quarters
      const midRow: DateColumn[] = []
      const topRow: DateColumn[] = []

      // midRow: months within view
      let cur = startOfMonth(viewStart)
      while (cur < viewEnd) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
        const clampStart = cur < viewStart ? viewStart : cur
        const clampEnd   = next > viewEnd ? viewEnd : next
        midRow.push({
          label: MONTH_SHORT[cur.getMonth()],
          startDate: clampStart,
          endDate: clampEnd,
          widthPx: diffDays(clampStart, clampEnd) * pxDay,
        })
        cur = next
      }

      // topRow: one entry per quarter
      let qCur = startOfQuarter(viewStart)
      while (qCur < viewEnd) {
        const qNext = new Date(qCur.getFullYear(), qCur.getMonth() + 3, 1)
        const clampStart = qCur < viewStart ? viewStart : qCur
        const clampEnd   = qNext > viewEnd ? viewEnd : qNext

        let label: string
        if (yearMode === 'financial') {
          const fyq = fyQuarter(qCur)
          const fyqStarts = [6, 9, 0, 3]  // Jul,Oct,Jan,Apr
          const fyqEnds   = [8, 11, 2, 5] // Sep,Dec,Mar,Jun
          const sm = fyqStarts[fyq - 1]
          const em = fyqEnds[fyq - 1]
          label = `FYQ${fyq} (${MONTH_SHORT[sm]}–${MONTH_SHORT[em]})`
        } else {
          const q = Math.floor(qCur.getMonth() / 3)
          const sm = q * 3; const em = sm + 2
          label = `Q${q + 1} (${MONTH_SHORT[sm]}–${MONTH_SHORT[em]})`
        }

        topRow.push({
          label,
          startDate: clampStart,
          endDate: clampEnd,
          widthPx: diffDays(clampStart, clampEnd) * pxDay,
        })
        qCur = qNext
      }

      return { topRow, midRow }
    }

    // ── Years ─────────────────────────────────────────────────────────────────
    case 'years': {
      const pxDay = PX_PER_DAY.years
      const midRow: DateColumn[] = []
      const topRow: DateColumn[] = []

      // midRow: quarters within view
      let cur = startOfQuarter(viewStart)
      while (cur < viewEnd) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 3, 1)
        const clampStart = cur < viewStart ? viewStart : cur
        const clampEnd   = next > viewEnd ? viewEnd : next

        let label: string
        if (yearMode === 'financial') {
          const fyq = fyQuarter(cur)
          const fyqStarts = [6, 9, 0, 3]
          const fyqEnds   = [8, 11, 2, 5]
          const sm = fyqStarts[fyq - 1]
          const em = fyqEnds[fyq - 1]
          label = `${MONTH_SHORT[sm]}–${MONTH_SHORT[em]}`
        } else {
          const sm = cur.getMonth()
          const em = sm + 2
          label = `${MONTH_SHORT[sm]}–${MONTH_SHORT[em]}`
        }

        midRow.push({
          label,
          startDate: clampStart,
          endDate: clampEnd,
          widthPx: diffDays(clampStart, clampEnd) * pxDay,
        })
        cur = next
      }

      // topRow: one entry per year (calendar or fiscal)
      if (yearMode === 'financial') {
        // FY starts July 1. Group quarters by FY year.
        const groups = new Map<number, { start: Date; end: Date; fy: number }>()
        for (const col of midRow) {
          const fy = fyYear(col.startDate)
          const g = groups.get(fy)
          if (!g) groups.set(fy, { start: col.startDate, end: col.endDate, fy })
          else {
            if (col.startDate < g.start) g.start = col.startDate
            if (col.endDate > g.end) g.end = col.endDate
          }
        }
        for (const [fy, g] of [...groups].sort((a, b) => a[0] - b[0])) {
          topRow.push({
            label: `FY${fy}`,
            startDate: g.start,
            endDate: g.end,
            widthPx: diffDays(g.start, g.end) * pxDay,
          })
        }
      } else {
        const groups = new Map<number, { start: Date; end: Date }>()
        for (const col of midRow) {
          const yr = col.startDate.getFullYear()
          const g = groups.get(yr)
          if (!g) groups.set(yr, { start: col.startDate, end: col.endDate })
          else {
            if (col.startDate < g.start) g.start = col.startDate
            if (col.endDate > g.end) g.end = col.endDate
          }
        }
        for (const [yr, g] of [...groups].sort((a, b) => a[0] - b[0])) {
          topRow.push({
            label: String(yr),
            startDate: g.start,
            endDate: g.end,
            widthPx: diffDays(g.start, g.end) * pxDay,
          })
        }
      }

      return { topRow, midRow }
    }
  }
}

/** Raw pixel offset from viewStart (not accounting for weekend hiding) */
function dateToPxRaw(d: Date, viewStart: Date, pxPerDay: number): number {
  return diffDays(viewStart, d) * pxPerDay
}

/** Group midRow (day columns) by month into topRow entries */
function groupIntoMonths(
  midRow: DateColumn[],
  _yearMode: YearMode,
  _showWeekends: boolean,
  _viewStart: Date,
  _viewEnd: Date,
  _pxDay: number,
): DateColumn[] {
  if (!midRow.length) return []
  const topRow: DateColumn[] = []
  let curMonth = -1; let curYear = -1
  let curStart: Date | null = null; let curWidth = 0

  for (const col of midRow) {
    const m = col.startDate.getMonth()
    const y = col.startDate.getFullYear()
    if (m !== curMonth || y !== curYear) {
      if (curStart && curWidth > 0) {
        topRow.push({
          label: `${MONTH_LONG[curMonth]} ${curYear}`,
          startDate: curStart,
          endDate: col.startDate,
          widthPx: curWidth,
        })
      }
      curMonth = m; curYear = y; curStart = col.startDate; curWidth = 0
    }
    curWidth += col.widthPx
  }
  if (curStart && curWidth > 0) {
    topRow.push({
      label: `${MONTH_LONG[curMonth]} ${curYear}`,
      startDate: curStart,
      endDate: midRow[midRow.length - 1].endDate,
      widthPx: curWidth,
    })
  }
  return topRow
}

/** Group week columns (midRow) by the month their start date falls in */
function groupWeeksByMonth(midRow: DateColumn[], yearMode: YearMode): DateColumn[] {
  if (!midRow.length) return []
  const topRow: DateColumn[] = []
  let curKey = ''; let curStart: Date | null = null; let curWidth = 0
  let curMonth = -1; let curYear = -1

  for (const col of midRow) {
    const m = col.startDate.getMonth()
    const y = yearMode === 'financial' ? fyYear(col.startDate) : col.startDate.getFullYear()
    const key = `${y}-${m}`
    if (key !== curKey) {
      if (curStart && curWidth > 0) {
        topRow.push({
          label: `${MONTH_LONG[curMonth]} ${curYear}`,
          startDate: curStart,
          endDate: col.startDate,
          widthPx: curWidth,
        })
      }
      curKey = key
      curStart = col.startDate
      curMonth = col.startDate.getMonth()
      curYear = col.startDate.getFullYear()
      curWidth = 0
    }
    curWidth += col.widthPx
  }
  if (curStart && curWidth > 0) {
    topRow.push({
      label: `${MONTH_LONG[curMonth]} ${curYear}`,
      startDate: curStart,
      endDate: midRow[midRow.length - 1].endDate,
      widthPx: curWidth,
    })
  }
  return topRow
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
