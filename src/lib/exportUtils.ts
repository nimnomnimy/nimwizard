import type { Timeline, Contact, TaskBucket, DottedLine, PeerLine } from '../types'
import { downloadCSV, LEVEL_LABELS } from './utils'
import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import PptxGenJS from 'pptxgenjs'
import { parseDate, diffDays } from '../components/timelines/utils/dateLayout'

// ─── Org chart data type ──────────────────────────────────────────────────────

export interface OrgChartData {
  contacts: Contact[]
  positions: Record<string, { x: number; y: number }>
  dottedLines: DottedLine[]
  peerLines: PeerLine[]
}

// ─── ExcelJS helpers ──────────────────────────────────────────────────────────

async function downloadXLSX(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function addSheetFromRows(wb: ExcelJS.Workbook, sheetName: string, rows: string[][], headerColor = '6366f1') {
  const ws = wb.addWorksheet(sheetName)
  if (!rows.length) return ws
  // Header row
  const hRow = ws.addRow(rows[0])
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + headerColor } }
  hRow.alignment = { vertical: 'middle' }
  hRow.height = 20
  // Data rows — alternating shading
  rows.slice(1).forEach((r, i) => {
    const row = ws.addRow(r)
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    row.alignment = { vertical: 'middle' }
    row.height = 18
  })
  // Auto-width columns
  ws.columns.forEach((col, i) => {
    const maxLen = rows.reduce((m, r) => Math.max(m, (r[i] ?? '').length), 0)
    col.width = Math.min(45, Math.max(10, maxLen + 2))
  })
  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  return ws
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────

/** Draw a filled rounded rectangle in jsPDF (coordinates in mm) */
function pdfRoundRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fill: boolean, stroke: boolean) {
  doc.roundedRect(x, y, w, h, r, r, (fill && stroke) ? 'FD' : fill ? 'F' : 'S')
}

/** Truncate text to fit maxWidth in current font */
function pdfFitText(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
  return t + '…'
}

// ─── PPTX helpers ─────────────────────────────────────────────────────────────

/** Hex color string → pptxgenjs color (strip #) */
function pc(hex: string) { return hex.replace('#', '') }

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dateToPx(start: Date, dateStr: string, pxPerDay: number): number {
  return Math.max(0, diffDays(start, parseDate(dateStr))) * pxPerDay
}

// ─── Timeline rows (shared by CSV / XLSX) ────────────────────────────────────

function buildTimelineRows(timeline: Timeline): string[][] {
  const rows: string[][] = [['Type', 'Lane', 'Name', 'Start', 'End / Date', 'Progress %', 'Notes']]
  for (const m of timeline.milestones) {
    rows.push(['Milestone', '', m.label, m.date, m.date, '', ''])
  }
  for (const lane of timeline.swimLanes) {
    for (const item of timeline.items.filter(i => i.swimLaneId === lane.id)) {
      rows.push(['Task', lane.label, item.label, item.startDate, item.endDate, String(item.progress), item.notes ?? ''])
      for (const sub of item.subItems ?? []) {
        rows.push(['Subtask', lane.label, `  └ ${sub.label}`, sub.startDate, sub.endDate, String(sub.progress), ''])
      }
    }
  }
  return rows
}

// ─── Gantt PDF renderer ───────────────────────────────────────────────────────

function addGanttToPDF(doc: jsPDF, timeline: Timeline) {
  // Use full page dimensions — caller creates doc as A3 landscape
  const pageW = doc.internal.pageSize.getWidth()   // mm
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const labelW = 55   // mm for task label column
  const rulerH = 14
  const rowH   = 12   // tall enough to read at normal zoom
  const usableW = pageW - margin * 2 - labelW
  const usableH = pageH - margin - 26

  // Compute date range and scale
  const start    = parseDate(timeline.startDate)
  const end      = parseDate(timeline.endDate)
  const totalDays = diffDays(start, end) || 1

  // Build month groups
  interface MonthGroup { label: string; startDay: number; days: number }
  const groups: MonthGroup[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cur < end) {
    const gs = new Date(Math.max(cur.getTime(), start.getTime()))
    const ge = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    const ce = new Date(Math.min(ge.getTime(), end.getTime()))
    groups.push({ label: gs.toLocaleString('default', { month: 'short', year: '2-digit' }), startDay: diffDays(start, gs), days: diffDays(gs, ce) })
    cur.setMonth(cur.getMonth() + 1)
  }

  // Title + date range
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text(timeline.name, margin, margin + 7)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
  doc.text(`${timeline.startDate} – ${timeline.endDate}`, margin, margin + 14)

  // Count rows
  const allRows: Array<{ type: 'lane' | 'bar'; label: string; color: string; start?: string; end?: string; progress?: number }> = []
  for (const lane of timeline.swimLanes) {
    allRows.push({ type: 'lane', label: lane.label, color: lane.color })
    for (const item of timeline.items.filter(i => i.swimLaneId === lane.id && i.type === 'bar')) {
      allRows.push({ type: 'bar', label: item.label, color: item.color, start: item.startDate, end: item.endDate, progress: item.progress })
    }
  }

  // Scale rows to fit if needed
  const availH = usableH - rulerH
  const rH = allRows.length > 0 ? Math.max(7, Math.min(rowH, availH / allRows.length)) : rowH
  const rRulerH = rulerH
  const chartH = rRulerH + allRows.length * rH

  const chartTop = margin + 20
  const chartLeft = margin
  const barAreaLeft = chartLeft + labelW
  const mmPerDay = usableW / totalDays

  // Background
  doc.setFillColor(248, 250, 252)
  doc.rect(chartLeft, chartTop, labelW + usableW, chartH, 'F')

  // Ruler — month columns
  for (const g of groups) {
    const gx = barAreaLeft + g.startDay * mmPerDay
    const gw = g.days * mmPerDay
    doc.setFillColor(225, 230, 240)
    doc.rect(gx, chartTop, gw, rRulerH, 'F')
    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.3)
    doc.rect(gx, chartTop, gw, rRulerH, 'S')
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(51, 65, 85)
    doc.text(g.label, gx + 2, chartTop + rRulerH * 0.68, { maxWidth: gw - 3 })
  }

  // Freeze periods — drawn before bars so they appear as background overlays
  for (const fp of timeline.freezePeriods ?? []) {
    const fx = barAreaLeft + dateToPx(start, fp.startDate, mmPerDay)
    const fw = Math.max(0.5, dateToPx(start, fp.endDate, mmPerDay) - dateToPx(start, fp.startDate, mmPerDay))
    if (fx > barAreaLeft + usableW || fx + fw < barAreaLeft) continue
    const [fr, fg, fb] = hexToRgb(fp.color)
    doc.setFillColor(fr, fg, fb)
    doc.setGState(new (doc as any).GState({ opacity: 0.12 }))
    doc.rect(Math.max(fx, barAreaLeft), chartTop + rRulerH, Math.min(fw, barAreaLeft + usableW - Math.max(fx, barAreaLeft)), allRows.length * rH, 'F')
    doc.setGState(new (doc as any).GState({ opacity: 1 }))
    // Border line
    doc.setDrawColor(fr, fg, fb); doc.setLineWidth(0.5)
    doc.setLineDashPattern([1.5, 1.5], 0)
    if (fx >= barAreaLeft) doc.line(fx, chartTop + rRulerH, fx, chartTop + chartH)
    if (fx + fw <= barAreaLeft + usableW) doc.line(fx + fw, chartTop + rRulerH, fx + fw, chartTop + chartH)
    doc.setLineDashPattern([], 0)
    // Label
    if (fw > 6) {
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(fr, fg, fb)
      doc.text(fp.label, Math.max(fx, barAreaLeft) + 1.5, chartTop + rRulerH + 5, { maxWidth: fw - 3 })
    }
  }

  // Today line
  const todayDays = diffDays(start, new Date())
  if (todayDays > 0 && todayDays < totalDays) {
    const tx = barAreaLeft + todayDays * mmPerDay
    doc.setDrawColor(99, 102, 241); doc.setLineWidth(0.5)
    doc.setLineDashPattern([1.5, 1], 0)
    doc.line(tx, chartTop, tx, chartTop + chartH)
    doc.setLineDashPattern([], 0)
  }

  // Rows
  let y = chartTop + rRulerH
  for (const row of allRows) {
    if (row.type === 'lane') {
      // Lane header
      const [r, g, b] = hexToRgb(row.color)
      doc.setFillColor(r, g, b)
      doc.setGState(new (doc as any).GState({ opacity: 0.12 }))
      doc.rect(chartLeft, y, labelW + usableW, rH, 'F')
      doc.setGState(new (doc as any).GState({ opacity: 1 }))
      doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2)
      doc.rect(chartLeft, y, labelW + usableW, rH, 'S')
      // Color dot
      doc.setFillColor(r, g, b)
      doc.circle(chartLeft + 4, y + rH / 2, 1.8, 'F')
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(r, g, b)
      doc.text(row.label.toUpperCase(), chartLeft + 8, y + rH * 0.65, { maxWidth: labelW - 10 })
    } else {
      // Task row
      doc.setFillColor(255, 255, 255)
      doc.rect(chartLeft, y, labelW + usableW, rH, 'F')
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.15)
      doc.rect(chartLeft, y, labelW + usableW, rH, 'S')
      // Label
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(51, 65, 85)
      doc.text(pdfFitText(doc, row.label, labelW - 8), chartLeft + 4, y + rH * 0.65, { maxWidth: labelW - 6 })
      // Bar
      if (row.start && row.end) {
        const bx = barAreaLeft + dateToPx(start, row.start, mmPerDay)
        const bw = Math.max(1, dateToPx(start, row.end, mmPerDay) - dateToPx(start, row.start, mmPerDay))
        const bh = rH * 0.6
        const by = y + (rH - bh) / 2
        const [r, g, b] = hexToRgb(row.color)
        doc.setFillColor(r, g, b); doc.setDrawColor(r, g, b); doc.setLineWidth(0)
        pdfRoundRect(doc, bx, by, bw, bh, 1.5, true, false)
        // Progress overlay (darker fill for done portion)
        if ((row.progress ?? 0) > 0 && bw > 2) {
          doc.setFillColor(0, 0, 0)
          doc.setGState(new (doc as any).GState({ opacity: 0.22 }))
          pdfRoundRect(doc, bx, by, bw * (row.progress! / 100), bh, 1.5, true, false)
          doc.setGState(new (doc as any).GState({ opacity: 1 }))
        }
        // Bar label
        if (bw > 12) {
          doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
          doc.text(pdfFitText(doc, row.label, bw - 3), bx + 1.5, by + bh * 0.70, { maxWidth: bw - 3 })
        }
      }
    }
    y += rH
  }

  // Vertical separator at label edge
  doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.4)
  doc.line(barAreaLeft, chartTop, barAreaLeft, chartTop + chartH)

  // Milestones (drawn on top)
  for (const m of timeline.milestones) {
    const mx = barAreaLeft + dateToPx(start, m.date, mmPerDay)
    if (mx < barAreaLeft || mx > barAreaLeft + usableW) continue
    const [r, g, b] = hexToRgb(m.color)
    doc.setFillColor(r, g, b)
    const mr = 2.5
    doc.lines([[mr, mr], [mr, -mr], [-mr, -mr], [-mr, mr]], mx, chartTop + rRulerH / 2, [1, 1], 'F', true)
    doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(r, g, b)
    doc.text(m.label, mx, chartTop + 4, { align: 'center' })
  }

  // Outer border
  doc.setDrawColor(148, 163, 184); doc.setLineWidth(0.4)
  doc.rect(chartLeft, chartTop, labelW + usableW, chartH, 'S')
}

// ─── Gantt PPTX renderer ──────────────────────────────────────────────────────

function addGanttToPPTX(pptx: PptxGenJS, timeline: Timeline) {
  const slide = pptx.addSlide()

  // Title
  slide.addText(timeline.name, { x: 0.3, y: 0.1, w: 9.4, h: 0.4, fontSize: 14, bold: true, color: '1e293b' })

  const chartLeft  = 0.3   // inches
  const chartTop   = 0.6
  const labelW     = 1.6
  const chartW     = 9.4
  const barAreaW   = chartW - labelW
  const rulerH     = 0.22
  const rowH       = 0.22

  const start     = parseDate(timeline.startDate)
  const end       = parseDate(timeline.endDate)
  const totalDays = diffDays(start, end) || 1

  // Month groups for ruler
  const groups: { label: string; startDay: number; days: number }[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cur < end) {
    const gs = new Date(Math.max(cur.getTime(), start.getTime()))
    const ge = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    const ce = new Date(Math.min(ge.getTime(), end.getTime()))
    groups.push({ label: gs.toLocaleString('default', { month: 'short', year: '2-digit' }), startDay: diffDays(start, gs), days: diffDays(gs, ce) })
    cur.setMonth(cur.getMonth() + 1)
  }

  const inPerDay = barAreaW / totalDays

  // Ruler background
  slide.addShape(pptx.ShapeType.rect, { x: chartLeft + labelW, y: chartTop, w: barAreaW, h: rulerH, fill: { color: 'f1f5f9' }, line: { color: 'e2e8f0', width: 0.5 } })

  // Month headers
  for (const g of groups) {
    const gx = chartLeft + labelW + g.startDay * inPerDay
    const gw = g.days * inPerDay
    slide.addShape(pptx.ShapeType.rect, { x: gx, y: chartTop, w: gw, h: rulerH, fill: { color: 'f8fafc' }, line: { color: 'e2e8f0', width: 0.3 } })
    slide.addText(g.label, { x: gx + 0.03, y: chartTop + 0.03, w: gw - 0.06, h: rulerH - 0.06, fontSize: 5.5, bold: true, color: '475569', valign: 'middle' })
  }

  // Label column header
  slide.addShape(pptx.ShapeType.rect, { x: chartLeft, y: chartTop, w: labelW, h: rulerH, fill: { color: 'e2e8f0' }, line: { color: 'cbd5e1', width: 0.3 } })

  // Freeze periods
  const allRowCount = timeline.swimLanes.length + timeline.items.filter(i => i.type === 'bar').length
  for (const fp of timeline.freezePeriods ?? []) {
    const fx = chartLeft + labelW + diffDays(start, parseDate(fp.startDate)) * inPerDay
    const fw = Math.max(0.01, diffDays(parseDate(fp.startDate), parseDate(fp.endDate)) * inPerDay)
    if (fx > chartLeft + chartW || fx + fw < chartLeft + labelW) continue
    const fpColor = pc(fp.color)
    // Shaded background over all rows
    slide.addShape(pptx.ShapeType.rect, {
      x: Math.max(fx, chartLeft + labelW),
      y: chartTop + rulerH,
      w: Math.min(fw, chartLeft + chartW - Math.max(fx, chartLeft + labelW)),
      h: allRowCount * rowH,
      fill: { color: fpColor, transparency: 88 },
      line: { color: fpColor, width: 0 },
    })
    // Left border dashed line
    if (fx >= chartLeft + labelW && fx <= chartLeft + chartW) {
      slide.addShape(pptx.ShapeType.line, { x: fx, y: chartTop + rulerH, w: 0, h: allRowCount * rowH, line: { color: fpColor, width: 0.6, dashType: 'dash' } })
    }
    // Right border dashed line
    if (fx + fw >= chartLeft + labelW && fx + fw <= chartLeft + chartW) {
      slide.addShape(pptx.ShapeType.line, { x: fx + fw, y: chartTop + rulerH, w: 0, h: allRowCount * rowH, line: { color: fpColor, width: 0.6, dashType: 'dash' } })
    }
    // Label
    if (fw > 0.2) {
      slide.addText(fp.label, { x: Math.max(fx, chartLeft + labelW) + 0.02, y: chartTop + rulerH + 0.02, w: Math.min(fw, 1.5), h: 0.14, fontSize: 5, bold: true, color: fpColor })
    }
  }

  // Today line
  const todayDays = diffDays(start, new Date())
  if (todayDays > 0 && todayDays < totalDays) {
    const tx = chartLeft + labelW + todayDays * inPerDay
    const allRows = timeline.swimLanes.length + timeline.items.filter(i => i.type === 'bar').length
    slide.addShape(pptx.ShapeType.line, { x: tx, y: chartTop, w: 0, h: rulerH + allRows * rowH, line: { color: '6366f1', width: 0.8, dashType: 'dash' } })
  }

  // Rows
  let rowY = chartTop + rulerH
  for (const lane of timeline.swimLanes) {
    const items = timeline.items.filter(i => i.swimLaneId === lane.id && i.type === 'bar')
    const laneColor = pc(lane.color)
    const totalRowsInLane = 1 + items.length

    // Lane header
    slide.addShape(pptx.ShapeType.rect, { x: chartLeft, y: rowY, w: labelW, h: rowH, fill: { color: 'f8fafc' }, line: { color: 'e2e8f0', width: 0.2 } })
    slide.addShape(pptx.ShapeType.rect, { x: chartLeft + labelW, y: rowY, w: barAreaW, h: rowH, fill: { color: 'f8fafc' }, line: { color: 'e2e8f0', width: 0.2 } })
    // Color dot
    slide.addShape(pptx.ShapeType.ellipse, { x: chartLeft + 0.06, y: rowY + rowH / 2 - 0.055, w: 0.11, h: 0.11, fill: { color: laneColor }, line: { color: laneColor, width: 0 } })
    slide.addText(lane.label.toUpperCase(), { x: chartLeft + 0.22, y: rowY, w: labelW - 0.25, h: rowH, fontSize: 5.5, bold: true, color: laneColor, valign: 'middle' })
    rowY += rowH

    // Bar rows
    for (const item of items) {
      // Row background
      slide.addShape(pptx.ShapeType.rect, { x: chartLeft, y: rowY, w: labelW, h: rowH, fill: { color: 'ffffff' }, line: { color: 'f1f5f9', width: 0.15 } })
      slide.addShape(pptx.ShapeType.rect, { x: chartLeft + labelW, y: rowY, w: barAreaW, h: rowH, fill: { color: 'ffffff' }, line: { color: 'f1f5f9', width: 0.15 } })
      // Task label
      slide.addText(item.label, { x: chartLeft + 0.08, y: rowY, w: labelW - 0.1, h: rowH, fontSize: 5, color: '475569', valign: 'middle' })

      // Bar
      const bx = chartLeft + labelW + dateToPx(start, item.startDate, inPerDay)
      const bwRaw = dateToPx(start, item.endDate, inPerDay) - dateToPx(start, item.startDate, inPerDay)
      const bw = Math.max(0.03, bwRaw)
      const barH = rowH * 0.65
      const barY = rowY + (rowH - barH) / 2
      const barColor = pc(item.color)

      slide.addShape(pptx.ShapeType.roundRect, { x: bx, y: barY, w: bw, h: barH, fill: { color: barColor }, line: { color: barColor, width: 0 }, rectRadius: 0.05 })

      // Progress overlay
      if ((item.progress ?? 0) > 0 && bw > 0.05) {
        const pw = bw * (item.progress / 100)
        slide.addShape(pptx.ShapeType.roundRect, { x: bx, y: barY, w: pw, h: barH, fill: { color: '000000', transparency: 75 }, line: { width: 0 }, rectRadius: 0.05 })
      }

      // Bar text label
      if (bw > 0.2) {
        slide.addText(item.label, { x: bx + 0.03, y: barY, w: bw - 0.06, h: barH, fontSize: 4.5, bold: true, color: 'ffffff', valign: 'middle' })
      }

      rowY += rowH
    }

    // Lane group border
    slide.addShape(pptx.ShapeType.rect, { x: chartLeft, y: rowY - rowH * totalRowsInLane, w: chartW, h: rowH * totalRowsInLane, line: { color: 'e2e8f0', width: 0.4 }, fill: { type: 'none' } })
  }

  // Milestones
  for (const m of timeline.milestones) {
    const mx = chartLeft + labelW + dateToPx(start, m.date, inPerDay)
    if (mx < chartLeft + labelW || mx > chartLeft + chartW) continue
    const mColor = pc(m.color)
    const totalH = (timeline.swimLanes.length + timeline.items.filter(i => i.type === 'bar').length) * rowH
    // Diamond shape
    slide.addShape(pptx.ShapeType.diamond, { x: mx - 0.07, y: chartTop + rulerH / 2 - 0.07, w: 0.14, h: 0.14, fill: { color: mColor }, line: { color: mColor, width: 0 } })
    // Vertical line
    slide.addShape(pptx.ShapeType.line, { x: mx, y: chartTop + rulerH, w: 0, h: totalH, line: { color: mColor, width: 0.5, dashType: 'dash', transparency: 50 } })
    // Label
    slide.addText(m.label, { x: mx - 0.5, y: chartTop, w: 1, h: rulerH * 0.5, fontSize: 4.5, bold: true, color: mColor, align: 'center' })
  }

  // Outer border
  slide.addShape(pptx.ShapeType.rect, {
    x: chartLeft, y: chartTop, w: chartW,
    h: rulerH + (timeline.swimLanes.length + timeline.items.filter(i => i.type === 'bar').length) * rowH,
    line: { color: 'cbd5e1', width: 0.5 }, fill: { type: 'none' }
  })
  // Label / bar separator
  slide.addShape(pptx.ShapeType.line, {
    x: chartLeft + labelW, y: chartTop, w: 0,
    h: rulerH + (timeline.swimLanes.length + timeline.items.filter(i => i.type === 'bar').length) * rowH,
    line: { color: 'cbd5e1', width: 0.5 }
  })
}

// ─── Org chart PDF renderer ───────────────────────────────────────────────────

function addOrgChartToPDF(doc: jsPDF, data: OrgChartData) {
  const { contacts, positions, dottedLines, peerLines } = data
  const visible = contacts.filter(c => positions[c.id])
  if (!visible.length) return

  // Positions are in screen pixels (96dpi). Convert to mm: 1px = 0.264583mm
  const PX_TO_MM = 0.264583
  // Fixed card dimensions in mm — always legible regardless of chart size
  const nW = 52   // mm
  const nH = 22   // mm

  const margin = 8   // mm
  const titleH = 10  // mm

  // Compute layout bounds in mm
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of visible) {
    const p = positions[c.id]
    const px = p.x * PX_TO_MM; const py = p.y * PX_TO_MM
    minX = Math.min(minX, px); minY = Math.min(minY, py)
    maxX = Math.max(maxX, px + nW); maxY = Math.max(maxY, py + nH)
  }

  // Centre the chart horizontally and vertically on the page
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const chartWmm = maxX - minX
  const chartHmm = maxY - minY
  const usableW = pageW - margin * 2
  const usableH = pageH - margin * 2 - titleH
  const offX = margin + (usableW - chartWmm) / 2 - minX
  const offY = margin + titleH + (usableH - chartHmm) / 2 - minY

  function sx(x: number) { return offX + x * PX_TO_MM }
  function sy(y: number) { return offY + y * PX_TO_MM }

  // vGap and hGap in mm (matching web defaults converted from px)
  const vGapMM = 60 * PX_TO_MM
  const LINE_COLOR: [number, number, number] = [203, 213, 225]
  const ASST_COLOR: [number, number, number] = [100, 116, 139]

  // Title
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
  doc.text('Org Chart', margin, margin + 5)

  // ── Hierarchy lines: trunk + bus + stubs (matching web drawConnections) ──────
  const visibleIds = new Set(visible.map(c => c.id))
  const childrenByParent: Record<string, string[]> = {}
  visible.forEach(c => {
    if (c.parentId && visibleIds.has(c.parentId)) {
      if (!childrenByParent[c.parentId]) childrenByParent[c.parentId] = []
      childrenByParent[c.parentId].push(c.id)
    }
  })

  Object.entries(childrenByParent).forEach(([parentId, childIds]) => {
    const par = positions[parentId]
    if (!par) return
    const parCX = sx(par.x) + nW / 2
    const trunkTop = sy(par.y) + nH
    const busY = trunkTop + vGapMM / 2

    const regularIds   = childIds.filter(id => !visible.find(c => c.id === id)?.isAssistant)
    const assistantIds = childIds.filter(id =>  visible.find(c => c.id === id)?.isAssistant)

    if (regularIds.length > 0) {
      // Trunk: parent bottom-center → bus Y
      doc.setDrawColor(...LINE_COLOR); doc.setLineWidth(0.3); doc.setLineDashPattern([], 0)
      doc.line(parCX, trunkTop, parCX, busY)

      // Horizontal bus spanning all regular child centres
      const childCXs = regularIds.map(id => sx(positions[id].x) + nW / 2)
      const busLeft  = Math.min(parCX, ...childCXs)
      const busRight = Math.max(parCX, ...childCXs)
      if (busLeft < busRight) doc.line(busLeft, busY, busRight, busY)

      // Stubs: bus → each child top-centre
      regularIds.forEach(id => {
        const p = positions[id]
        if (!p) return
        const cx = sx(p.x) + nW / 2
        doc.line(cx, busY, cx, sy(p.y))
      })
    }

    // Assistant: dashed tap off trunk midpoint → horizontal → card mid-Y
    if (assistantIds.length > 0) {
      const tapY = trunkTop + (busY - trunkTop) * 0.5
      if (regularIds.length === 0) {
        doc.setDrawColor(...ASST_COLOR); doc.setLineWidth(0.3); doc.setLineDashPattern([1.5, 1], 0)
        doc.line(parCX, trunkTop, parCX, tapY)
      }
      assistantIds.forEach(id => {
        const p = positions[id]
        if (!p) return
        const chMidY = sy(p.y) + nH / 2
        const goRight = parCX <= sx(p.x) + nW / 2
        const chEdgeX = goRight ? sx(p.x) : sx(p.x) + nW
        doc.setDrawColor(...ASST_COLOR); doc.setLineWidth(0.3); doc.setLineDashPattern([1.5, 1], 0)
        doc.line(parCX, tapY, chEdgeX, tapY)
        doc.line(chEdgeX, tapY, chEdgeX, chMidY)
        // Hollow circle at tap point
        doc.setLineDashPattern([], 0)
        doc.setFillColor(255, 255, 255)
        doc.circle(parCX, tapY, 1.2, 'FD')
      })
      doc.setLineDashPattern([], 0)
    }
  })

  // ── Dotted lines (reporting relationships) ───────────────────────────────────
  dottedLines.forEach(dl => {
    const fp = positions[dl.fromId]; const tp = positions[dl.toId]
    if (!fp || !tp) return
    doc.setDrawColor(139, 92, 246); doc.setLineWidth(0.3); doc.setLineDashPattern([1.5, 1], 0)
    const x1 = sx(fp.x) + nW / 2; const y1 = sy(fp.y) + nH
    const x2 = sx(tp.x) + nW / 2; const y2 = sy(tp.y)
    const my  = (y1 + y2) / 2
    doc.lines([[0, my - y1], [x2 - x1, 0], [0, y2 - my]], x1, y1)
    doc.setLineDashPattern([], 0)
  })

  // ── Peer lines ────────────────────────────────────────────────────────────────
  peerLines.forEach(pl => {
    const fp = positions[pl.fromId]; const tp = positions[pl.toId]
    if (!fp || !tp) return
    doc.setDrawColor(245, 158, 11); doc.setLineWidth(0.3); doc.setLineDashPattern([1.5, 1], 0)
    const left  = fp.x < tp.x ? fp : tp
    const right = fp.x < tp.x ? tp : fp
    const y1 = sy(left.y) + nH / 2; const y2 = sy(right.y) + nH / 2
    const x1 = sx(left.x) + nW;     const x2 = sx(right.x)
    const mx  = (x1 + x2) / 2
    doc.lines([[mx - x1, 0], [0, y2 - y1], [x2 - mx, 0]], x1, y1)
    doc.setLineDashPattern([], 0)
  })

  // Cards — fixed size in mm, always legible
  for (const contact of visible) {
    const p = positions[contact.id]
    const x = sx(p.x); const y = sy(p.y)

    // Shadow
    doc.setFillColor(230, 232, 240)
    pdfRoundRect(doc, x + 0.4, y + 0.4, nW, nH, 1.5, true, false)
    // Card
    doc.setFillColor(255, 255, 255); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2)
    pdfRoundRect(doc, x, y, nW, nH, 1.5, true, true)

    // Avatar circle
    const avR = 4.2
    const avX = x + 4 + avR; const avY = y + nH / 2
    const [ar, ag, ab] = hexToRgb(avatarColorFromName(contact.name))
    doc.setFillColor(ar, ag, ab)
    doc.circle(avX, avY, avR, 'F')

    // Avatar initials
    const ini = contactInitials(contact.name)
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255)
    const iw = doc.getTextWidth(ini)
    doc.text(ini, avX - iw / 2, avY + 1.2)

    // Text — fixed font sizes so always readable
    const tx = avX + avR + 2.5
    const maxTw = nW - (tx - x) - 2

    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
    doc.text(pdfFitText(doc, contact.name, maxTw), tx, y + 7)

    if (contact.title) {
      doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139)
      doc.text(pdfFitText(doc, contact.title, maxTw), tx, y + 12)
    }

    if (contact.level) {
      const badge = LEVEL_LABELS[contact.level] ?? contact.level
      doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(59, 130, 246)
      doc.text(badge.toUpperCase(), tx, y + 17)
    }
  }
}

// ─── Org chart PPTX renderer ──────────────────────────────────────────────────

function addOrgChartToPPTX(pptx: PptxGenJS, slide: PptxGenJS.Slide, data: OrgChartData) {
  const { contacts, positions, dottedLines, peerLines } = data
  const visible = contacts.filter(c => positions[c.id])
  if (!visible.length) return

  // Positions are in screen pixels. Convert to inches: 1px = 1/96in
  const PX_TO_IN = 1 / 96
  // Fixed card size in inches — always legible on any slide
  const nW = 2.0   // inches
  const nH = 0.85  // inches

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of visible) {
    const p = positions[c.id]
    const px = p.x * PX_TO_IN; const py = p.y * PX_TO_IN
    minX = Math.min(minX, px); minY = Math.min(minY, py)
    maxX = Math.max(maxX, px + nW); maxY = Math.max(maxY, py + nH)
  }

  const margin = 0.3   // inches
  const titleH = 0.5

  // Centre the chart on the slide (default 10" × 7.5")
  const slideW = 10.0; const slideH = 7.5
  const chartWin = maxX - minX
  const chartHin = maxY - minY
  const usableW = slideW - margin * 2
  const usableH = slideH - titleH - margin * 2
  const offX = margin + (usableW - chartWin) / 2 - minX
  const offY = titleH + margin + (usableH - chartHin) / 2 - minY

  function sx(x: number) { return offX + x * PX_TO_IN }
  function sy(y: number) { return offY + y * PX_TO_IN }

  const vGapIN = 60 * PX_TO_IN
  const solidLine = { color: 'cbd5e1', width: 0.75, dashType: 'solid' as const }
  const asstLine  = { color: '64748b', width: 0.75, dashType: 'dash' as const }

  type LineProps = { color: string; width: number; dashType: 'solid' | 'dash' }
  function seg(x: number, y: number, w: number, h: number, lp: LineProps) {
    slide.addShape(pptx.ShapeType.line, { x, y, w, h, line: lp })
  }

  // Title
  slide.addText('Org Chart', { x: 0.3, y: 0.1, w: 9.4, h: 0.4, fontSize: 14, bold: true, color: '1e293b' })

  // ── Hierarchy lines ──────────────────────────────────────────────────────────
  const visibleIds = new Set(visible.map(c => c.id))
  const childrenByParent: Record<string, string[]> = {}
  visible.forEach(c => {
    if (c.parentId && visibleIds.has(c.parentId)) {
      if (!childrenByParent[c.parentId]) childrenByParent[c.parentId] = []
      childrenByParent[c.parentId].push(c.id)
    }
  })

  Object.entries(childrenByParent).forEach(([parentId, childIds]) => {
    const par = positions[parentId]
    if (!par) return
    const parCX    = sx(par.x) + nW / 2
    const trunkTop = sy(par.y) + nH
    const busY     = trunkTop + vGapIN / 2

    const regularIds   = childIds.filter(id => !visible.find(c => c.id === id)?.isAssistant)
    const assistantIds = childIds.filter(id =>  visible.find(c => c.id === id)?.isAssistant)

    if (regularIds.length > 0) {
      // Trunk
      seg(parCX, trunkTop, 0, busY - trunkTop, solidLine)
      // Bus
      const childCXs = regularIds.map(id => sx(positions[id].x) + nW / 2)
      const busLeft  = Math.min(parCX, ...childCXs)
      const busRight = Math.max(parCX, ...childCXs)
      if (busLeft < busRight) seg(busLeft, busY, busRight - busLeft, 0, solidLine)
      // Stubs
      regularIds.forEach(id => {
        const p = positions[id]
        if (!p) return
        const cx = sx(p.x) + nW / 2
        seg(cx, busY, 0, sy(p.y) - busY, solidLine)
      })
    }

    // Assistant lines: dashed tap off trunk
    if (assistantIds.length > 0) {
      const tapY = trunkTop + (busY - trunkTop) * 0.5
      if (regularIds.length === 0) seg(parCX, trunkTop, 0, tapY - trunkTop, asstLine)
      assistantIds.forEach(id => {
        const p = positions[id]
        if (!p) return
        const chMidY  = sy(p.y) + nH / 2
        const goRight = parCX <= sx(p.x) + nW / 2
        const chEdgeX = goRight ? sx(p.x) : sx(p.x) + nW
        seg(parCX, tapY, chEdgeX - parCX, 0, asstLine)
        seg(chEdgeX, Math.min(tapY, chMidY), 0, Math.abs(chMidY - tapY), asstLine)
        // Hollow circle at tap point
        slide.addShape(pptx.ShapeType.ellipse, { x: parCX - 0.04, y: tapY - 0.04, w: 0.08, h: 0.08, fill: { color: 'ffffff' }, line: { color: '64748b', width: 0.75 } })
      })
    }
  })

  // ── Dotted lines ─────────────────────────────────────────────────────────────
  dottedLines.forEach(dl => {
    const fp = positions[dl.fromId]; const tp = positions[dl.toId]
    if (!fp || !tp) return
    const lp = { color: '8b5cf6', width: 0.75, dashType: 'dash' as const }
    const x1 = sx(fp.x) + nW / 2; const y1 = sy(fp.y) + nH
    const x2 = sx(tp.x) + nW / 2; const y2 = sy(tp.y); const my = (y1 + y2) / 2
    seg(x1, y1, 0, my - y1, lp)
    seg(Math.min(x1, x2), my, Math.abs(x2 - x1), 0, lp)
    seg(x2, my, 0, y2 - my, lp)
  })

  // ── Peer lines ────────────────────────────────────────────────────────────────
  peerLines.forEach(pl => {
    const fp = positions[pl.fromId]; const tp = positions[pl.toId]
    if (!fp || !tp) return
    const lp = { color: 'f59e0b', width: 0.75, dashType: 'dash' as const }
    const left  = fp.x < tp.x ? fp : tp
    const right = fp.x < tp.x ? tp : fp
    const y1 = sy(left.y) + nH / 2; const y2 = sy(right.y) + nH / 2
    const x1 = sx(left.x) + nW;     const x2 = sx(right.x); const mx = (x1 + x2) / 2
    seg(x1, y1, mx - x1, 0, lp)
    seg(mx, Math.min(y1, y2), 0, Math.abs(y2 - y1), lp)
    seg(mx, y2, x2 - mx, 0, lp)
  })

  // Cards — fixed 2"×0.85" so text is always legible
  for (const contact of visible) {
    const p = positions[contact.id]
    const x = sx(p.x); const y = sy(p.y)
    const cardColor = pc(avatarColorFromName(contact.name))

    // Card shadow
    slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.02, y: y + 0.02, w: nW, h: nH, fill: { color: 'e2e8f0' }, line: { width: 0 }, rectRadius: 0.08 })
    // Card
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: nW, h: nH, fill: { color: 'ffffff' }, line: { color: 'e2e8f0', width: 0.5 }, rectRadius: 0.08 })

    // Avatar circle
    const avR = 0.18  // inches radius
    const avX = x + 0.15 + avR; const avY = y + nH / 2 - avR
    slide.addShape(pptx.ShapeType.ellipse, { x: avX - avR, y: avY, w: avR * 2, h: avR * 2, fill: { color: cardColor }, line: { width: 0 } })
    slide.addText(contactInitials(contact.name), {
      x: avX - avR, y: avY, w: avR * 2, h: avR * 2,
      fontSize: 9, bold: true, color: 'ffffff', align: 'center', valign: 'middle',
    })

    // Text content
    const tx = avX + avR + 0.1
    const tw = nW - (tx - x) - 0.1

    const lines: PptxGenJS.TextProps[] = [
      { text: contact.name, options: { bold: true, fontSize: 10, color: '1e293b', breakLine: true } },
    ]
    if (contact.title) lines.push({ text: contact.title, options: { fontSize: 9, color: '64748b', breakLine: true } })
    if (contact.level) lines.push({ text: (LEVEL_LABELS[contact.level] ?? contact.level).toUpperCase(), options: { fontSize: 8, color: '3b82f6', bold: true } })

    slide.addText(lines, { x: tx, w: tw, y: y + 0.07, h: nH - 0.1, valign: 'middle', wrap: true, color: '1e293b' })
  }
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const AVATAR_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#84cc16','#f97316','#ec4899','#6366f1']
function avatarColorFromName(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}
function contactInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ─── Contact rows ─────────────────────────────────────────────────────────────

function buildContactRows(contacts: Contact[]): string[][] {
  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })
  const rows: string[][] = [['Name', 'Title', 'Org', 'Level', 'Email', 'Phone', 'Reports To']]
  for (const c of contacts) {
    rows.push([c.name, c.title ?? '', c.org ?? '', c.level ? (LEVEL_LABELS[c.level] ?? c.level) : '', c.email ?? '', c.phone ?? '', c.parentId ? (idToName[c.parentId] ?? '') : ''])
  }
  return rows
}

// ─── Task rows ────────────────────────────────────────────────────────────────

function buildTaskRows(taskBuckets: TaskBucket[]): string[][] {
  const rows: string[][] = [['Bucket', 'Task', 'Priority', 'Start', 'Due', 'Progress %', 'Done', 'Notes', 'Subtask']]
  for (const bucket of taskBuckets) {
    for (const task of bucket.tasks) {
      rows.push([bucket.name, task.text, task.priority ?? '', task.startDate ?? '', task.due ?? '', String(task.progress ?? 0), '', task.notes ?? '', ''])
      for (const sub of task.subTasks ?? []) {
        rows.push([bucket.name, task.text, '', '', sub.due ?? '', String(sub.progress ?? 0), sub.done ? 'Yes' : '', sub.notes ?? '', sub.text])
      }
    }
  }
  return rows
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Timeline exports ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export function exportTimelineCSV(timeline: Timeline, _mode: 'gantt' | 'table' | 'both'): void {
  downloadCSV(buildTimelineRows(timeline), `${timeline.name}.csv`)
}

export async function exportTimelineXLSX(timeline: Timeline, mode: 'gantt' | 'table' | 'both'): Promise<void> {
  const wb = new ExcelJS.Workbook()

  if (mode === 'gantt' || mode === 'both') {
    // Gantt as structured data with color-coded lane rows
    const ws = wb.addWorksheet('Gantt')
    const header = ws.addRow(['Lane', 'Task / Subtask', 'Start', 'End', 'Progress %', 'Notes'])
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366f1' } }
    header.height = 20
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.columns = [{ width: 16 }, { width: 30 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 30 }]

    for (const lane of timeline.swimLanes) {
      const items = timeline.items.filter(i => i.swimLaneId === lane.id)
      // Lane header row
      const laneRow = ws.addRow([lane.label, '', '', '', '', ''])
      const [r, g, b] = hexToRgb(lane.color)
      const laneHex = lane.color.replace('#', 'FF')
      laneRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: laneHex } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      })
      laneRow.height = 18
      void [r, g, b]

      for (const item of items) {
        const row = ws.addRow([lane.label, item.label, item.startDate, item.endDate, item.progress, item.notes ?? ''])
        row.height = 16
        for (const sub of item.subItems ?? []) {
          const sRow = ws.addRow(['', `  └ ${sub.label}`, sub.startDate, sub.endDate, sub.progress, ''])
          sRow.getCell(2).font = { italic: true, color: { argb: 'FF64748b' } }
          sRow.height = 15
        }
      }
    }
    // Milestones
    if (timeline.milestones.length) {
      const mHeader = ws.addRow(['Milestones', '', '', '', '', ''])
      mHeader.font = { bold: true }; mHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFfef3c7' } }
      for (const m of timeline.milestones) {
        ws.addRow(['', m.label, m.date, m.date, '', ''])
      }
    }
  }

  if (mode === 'table' || mode === 'both') {
    addSheetFromRows(wb, 'Timeline Data', buildTimelineRows(timeline))
  }

  await downloadXLSX(wb, `${timeline.name}.xlsx`)
}

export async function exportTimelinePDF(timeline: Timeline, mode: 'gantt' | 'table' | 'both'): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a3' })

  if (mode === 'gantt' || mode === 'both') {
    addGanttToPDF(doc, timeline)
    if (mode === 'both') doc.addPage()
  }

  if (mode === 'table' || mode === 'both') {
    const rows = buildTimelineRows(timeline)
    if (mode !== 'both') { doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(timeline.name, 8, 14) }
    autoTable(doc, {
      head: [rows[0]], body: rows.slice(1),
      startY: mode === 'both' ? 8 : 20,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })
  }

  doc.save(`${timeline.name}.pdf`)
}

export async function exportTimelinePPTX(timeline: Timeline, mode: 'gantt' | 'table' | 'both'): Promise<void> {
  const pptx = new PptxGenJS()

  if (mode === 'gantt' || mode === 'both') {
    addGanttToPPTX(pptx, timeline)
  }

  if (mode === 'table' || mode === 'both') {
    for (const lane of timeline.swimLanes) {
      const items = timeline.items.filter(i => i.swimLaneId === lane.id)
      if (!items.length) continue
      const slide = pptx.addSlide()
      slide.addText(lane.label, { x: 0.5, y: 0.2, w: 9, h: 0.4, fontSize: 16, bold: true, color: pc(lane.color) })
      const header: PptxGenJS.TableRow = ['Task', 'Start', 'End', 'Progress %', 'Notes'].map(t => ({ text: t, options: { bold: true } }))
      const body: PptxGenJS.TableRow[] = []
      for (const item of items) {
        body.push([{ text: item.label }, { text: item.startDate }, { text: item.endDate }, { text: String(item.progress) }, { text: item.notes ?? '' }])
        for (const sub of item.subItems ?? []) {
          body.push([{ text: `  └ ${sub.label}`, options: { italic: true, color: '64748b' } }, { text: sub.startDate }, { text: sub.endDate }, { text: String(sub.progress) }, { text: '' }])
        }
      }
      slide.addTable([header, ...body], { x: 0.5, y: 0.7, w: 9, fontSize: 9, colW: [3, 1.2, 1.2, 1.0, 2.6], border: { pt: 0.5, color: 'e2e8f0' }, autoPage: true })
    }
  }

  await pptx.writeFile({ fileName: `${timeline.name}.pptx` })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Contact / Org chart exports ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export function exportContactsCSV(contacts: Contact[]): void {
  downloadCSV(buildContactRows(contacts), 'contacts.csv')
}

export async function exportContactsXLSX(contacts: Contact[], orgData: OrgChartData): Promise<void> {
  const wb = new ExcelJS.Workbook()
  // Org hierarchy sheet — structured, not image
  const ws = wb.addWorksheet('Org Chart')
  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })
  const hRow = ws.addRow(['Name', 'Title', 'Org', 'Level', 'Reports To', 'Email', 'Phone'])
  hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366f1' } }
  hRow.height = 20
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.columns = [{ width: 22 }, { width: 22 }, { width: 16 }, { width: 14 }, { width: 22 }, { width: 24 }, { width: 16 }]

  // Sort by level then name
  const sorted = [...contacts].sort((a, b) => {
    const lo: Record<string, number> = { 'c-level': 0, gm: 1, 'head-of': 2, director: 3, manager: 4, lead: 5, individual: 6 }
    return (lo[a.level ?? 'individual'] ?? 99) - (lo[b.level ?? 'individual'] ?? 99) || a.name.localeCompare(b.name)
  })
  sorted.forEach((c, i) => {
    const row = ws.addRow([c.name, c.title ?? '', c.org ?? '', c.level ? (LEVEL_LABELS[c.level] ?? c.level) : '', c.parentId ? (idToName[c.parentId] ?? '') : '', c.email ?? '', c.phone ?? ''])
    if (i % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
    row.height = 18
  })
  addSheetFromRows(wb, 'Contacts', buildContactRows(contacts))
  void orgData
  await downloadXLSX(wb, 'org-chart.xlsx')
}

export async function exportContactsPDF(contacts: Contact[], orgData: OrgChartData): Promise<void> {
  // Page size is computed from the chart layout in mm so cards always fit at fixed legible size.
  // Cards are 52×22mm. Positions are in px; 1px = 0.264583mm at 96dpi.
  const PX_TO_MM = 0.264583
  const CARD_W_MM = 52; const CARD_H_MM = 22
  let doc: jsPDF
  if (orgData.contacts.length > 0) {
    const vis = orgData.contacts.filter(c => orgData.positions[c.id])
    if (vis.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const c of vis) {
        const p = orgData.positions[c.id]
        const px = p.x * PX_TO_MM; const py = p.y * PX_TO_MM
        minX = Math.min(minX, px); minY = Math.min(minY, py)
        maxX = Math.max(maxX, px + CARD_W_MM); maxY = Math.max(maxY, py + CARD_H_MM)
      }
      const margin = 8; const titleH = 18
      const w = Math.max(297, maxX - minX + margin * 2 + 16)
      const h = Math.max(210, maxY - minY + margin * 2 + titleH + 16)
      doc = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', format: [w, h] })
    } else {
      doc = new jsPDF({ orientation: 'landscape' })
    }
  } else {
    doc = new jsPDF({ orientation: 'landscape' })
  }
  if (orgData.contacts.length > 0) {
    addOrgChartToPDF(doc, orgData)
    doc.addPage()
  }
  const rows = buildContactRows(contacts)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text('Contacts', 8, 14)
  autoTable(doc, {
    head: [rows[0]], body: rows.slice(1), startY: 20,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  })
  doc.save('org-chart.pdf')
}

export async function exportContactsPPTX(contacts: Contact[], orgData: OrgChartData): Promise<void> {
  const pptx = new PptxGenJS()

  if (orgData.contacts.length > 0) {
    const slide = pptx.addSlide()
    addOrgChartToPPTX(pptx, slide, orgData)
  }

  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })
  const sorted = [...contacts].sort((a, b) => {
    const lo: Record<string, number> = { 'c-level': 0, gm: 1, 'head-of': 2, director: 3, manager: 4, lead: 5, individual: 6 }
    return (lo[a.level ?? 'individual'] ?? 99) - (lo[b.level ?? 'individual'] ?? 99) || a.name.localeCompare(b.name)
  })
  const slide = pptx.addSlide()
  slide.addText('Contacts', { x: 0.5, y: 0.2, w: 9, h: 0.4, fontSize: 18, bold: true, color: '1e293b' })
  const header: PptxGenJS.TableRow = ['Name', 'Title', 'Org', 'Level', 'Reports To', 'Email', 'Phone'].map(t => ({ text: t, options: { bold: true } }))
  const body: PptxGenJS.TableRow[] = sorted.map(c => [
    { text: c.name, options: { bold: true } }, { text: c.title ?? '' }, { text: c.org ?? '' },
    { text: c.level ? (LEVEL_LABELS[c.level] ?? c.level) : '' },
    { text: c.parentId ? (idToName[c.parentId] ?? '') : '' },
    { text: c.email ?? '' }, { text: c.phone ?? '' },
  ])
  slide.addTable([header, ...body], { x: 0.5, y: 0.7, w: 9, fontSize: 9, colW: [1.5, 1.5, 1.1, 1.0, 1.5, 1.5, 0.9], border: { pt: 0.5, color: 'e2e8f0' }, autoPage: true })
  await pptx.writeFile({ fileName: 'org-chart.pptx' })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Task exports ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export function exportTasksCSV(taskBuckets: TaskBucket[]): void {
  downloadCSV(buildTaskRows(taskBuckets), 'tasks.csv')
}

export async function exportTasksXLSX(taskBuckets: TaskBucket[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  for (const bucket of taskBuckets) {
    if (!bucket.tasks.length) continue
    const ws = wb.addWorksheet(bucket.name.slice(0, 31))
    const hRow = ws.addRow(['Task', 'Priority', 'Start', 'Due', 'Progress %', 'Done', 'Notes'])
    hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bucket.color.replace('#', '') } }
    hRow.height = 20
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.columns = [{ width: 30 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 12 }, { width: 8 }, { width: 30 }]
    for (const task of bucket.tasks) {
      const row = ws.addRow([task.text, task.priority ?? '', task.startDate ?? '', task.due ?? '', task.progress ?? 0, '', task.notes ?? ''])
      row.height = 18
      for (const sub of task.subTasks ?? []) {
        const sRow = ws.addRow([`  └ ${sub.text}`, '', '', sub.due ?? '', sub.progress ?? 0, sub.done ? 'Yes' : '', sub.notes ?? ''])
        sRow.getCell(1).font = { italic: true, color: { argb: 'FF64748b' } }
        sRow.height = 15
      }
    }
  }
  await downloadXLSX(wb, 'tasks.xlsx')
}

export function exportTasksPDF(taskBuckets: TaskBucket[]): void {
  const doc = new jsPDF({ orientation: 'landscape' })
  let first = true
  for (const bucket of taskBuckets) {
    if (!bucket.tasks.length) continue
    if (!first) doc.addPage()
    first = false
    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
    doc.text(bucket.name, 8, 14)
    const rows: string[][] = [['Task', 'Priority', 'Start', 'Due', 'Progress %', 'Done', 'Notes']]
    for (const task of bucket.tasks) {
      rows.push([task.text, task.priority ?? '', task.startDate ?? '', task.due ?? '', String(task.progress ?? 0), '', task.notes ?? ''])
      for (const sub of task.subTasks ?? []) {
        rows.push([`  └ ${sub.text}`, '', '', sub.due ?? '', String(sub.progress ?? 0), sub.done ? 'Yes' : '', sub.notes ?? ''])
      }
    }
    autoTable(doc, {
      head: [rows[0]], body: rows.slice(1), startY: 20,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: hexToRgb(bucket.color), textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    })
  }
  doc.save('tasks.pdf')
}

export async function exportTasksPPTX(taskBuckets: TaskBucket[]): Promise<void> {
  const pptx = new PptxGenJS()
  for (const bucket of taskBuckets) {
    if (!bucket.tasks.length) continue
    const slide = pptx.addSlide()
    slide.addText(bucket.name, { x: 0.5, y: 0.2, w: 9, h: 0.4, fontSize: 18, bold: true, color: pc(bucket.color) })
    const header: PptxGenJS.TableRow = ['Task', 'Priority', 'Start', 'Due', 'Progress %', 'Done', 'Notes'].map(t => ({ text: t, options: { bold: true } }))
    const body: PptxGenJS.TableRow[] = []
    for (const task of bucket.tasks) {
      body.push([{ text: task.text, options: { bold: true } }, { text: task.priority ?? '' }, { text: task.startDate ?? '' }, { text: task.due ?? '' }, { text: String(task.progress ?? 0) }, { text: '' }, { text: task.notes ?? '' }])
      for (const sub of task.subTasks ?? []) {
        body.push([{ text: `  └ ${sub.text}`, options: { italic: true, color: '64748b' } }, { text: '' }, { text: '' }, { text: sub.due ?? '' }, { text: String(sub.progress ?? 0) }, { text: sub.done ? 'Yes' : '' }, { text: sub.notes ?? '' }])
      }
    }
    slide.addTable([header, ...body], { x: 0.5, y: 0.7, w: 9, fontSize: 9, colW: [2.5, 0.9, 1.0, 1.0, 1.0, 0.7, 1.9], border: { pt: 0.5, color: 'e2e8f0' }, autoPage: true })
  }
  await pptx.writeFile({ fileName: 'tasks.pptx' })
}
