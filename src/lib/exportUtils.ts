import type { Timeline, Contact, TaskBucket, DottedLine, PeerLine } from '../types'
import { downloadCSV, avatarColor, initials, LEVEL_LABELS } from './utils'
import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import PptxGenJS from 'pptxgenjs'
import { parseDate, PX_PER_DAY, diffDays } from '../components/timelines/utils/dateLayout'

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}

// ─── Org chart canvas renderer ────────────────────────────────────────────────

interface OrgChartData {
  contacts: Contact[]
  positions: Record<string, { x: number; y: number }>
  dottedLines: DottedLine[]
  peerLines: PeerLine[]
}

const ORG_NODE_W = 200
const ORG_NODE_H = 88
const ORG_AVATAR_R = 22
const ORG_PAD = 40  // padding around all nodes

export function drawOrgChart(data: OrgChartData): HTMLCanvasElement {
  const { contacts, positions, dottedLines, peerLines } = data
  const visible = contacts.filter(c => positions[c.id])
  if (!visible.length) {
    const c = document.createElement('canvas')
    c.width = 400; c.height = 200
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, 0, 400, 200)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '16px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No contacts in chart', 200, 100)
    return c
  }

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of visible) {
    const p = positions[c.id]
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + ORG_NODE_W)
    maxY = Math.max(maxY, p.y + ORG_NODE_H)
  }

  const scale = 2  // retina
  const W = (maxX - minX + ORG_PAD * 2) * scale
  const H = (maxY - minY + ORG_PAD * 2) * scale
  const offX = ORG_PAD - minX
  const offY = ORG_PAD - minY

  const canvas = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  // Background
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, 0, W, H)

  // Draw connections first (behind nodes)
  const idMap: Record<string, { x: number; y: number }> = {}
  for (const c of visible) {
    const p = positions[c.id]
    idMap[c.id] = { x: p.x + offX, y: p.y + offY }
  }

  function drawOrgLine(fromId: string, toId: string, style: 'solid' | 'dashed' | 'peer') {
    const fp = idMap[fromId]; const tp = idMap[toId]
    if (!fp || !tp) return
    ctx.save()
    ctx.lineWidth = 1.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (style === 'peer') {
      ctx.strokeStyle = '#f59e0b'
      ctx.setLineDash([6, 3])
      const left  = fp.x < tp.x ? fp : tp
      const right = fp.x < tp.x ? tp : fp
      const leftW = fp.x < tp.x ? ORG_NODE_W : ORG_NODE_W
      const y1 = left.y  + ORG_NODE_H / 2
      const y2 = right.y + ORG_NODE_H / 2
      const x1 = left.x  + leftW
      const x2 = right.x
      const mx  = (x1 + x2) / 2
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx, y1); ctx.lineTo(mx, y2); ctx.lineTo(x2, y2)
      ctx.stroke()
    } else {
      ctx.strokeStyle = style === 'dashed' ? '#8b5cf6' : '#cbd5e1'
      if (style === 'dashed') ctx.setLineDash([5, 4])
      const x1 = fp.x + ORG_NODE_W / 2, y1 = fp.y + ORG_NODE_H
      const x2 = tp.x + ORG_NODE_W / 2, y2 = tp.y
      const midY = (y1 + y2) / 2
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, midY); ctx.lineTo(x2, midY); ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Hierarchy lines (parent → child)
  for (const c of visible) {
    if (c.parentId && idMap[c.parentId]) drawOrgLine(c.parentId, c.id, 'solid')
  }
  // Dotted lines
  for (const dl of dottedLines) {
    if (idMap[dl.fromId] && idMap[dl.toId]) drawOrgLine(dl.fromId, dl.toId, 'dashed')
  }
  // Peer lines
  for (const pl of peerLines) {
    if (idMap[pl.fromId] && idMap[pl.toId]) drawOrgLine(pl.fromId, pl.toId, 'peer')
  }

  // Draw nodes
  for (const contact of visible) {
    const p = idMap[contact.id]
    const x = p.x, y = p.y

    // Card shadow
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.10)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 2
    ctx.fillStyle = '#ffffff'
    roundRect(ctx, x, y, ORG_NODE_W, ORG_NODE_H, 12)
    ctx.fill()
    ctx.restore()

    // Card border
    ctx.save()
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    roundRect(ctx, x, y, ORG_NODE_W, ORG_NODE_H, 12)
    ctx.stroke()
    ctx.restore()

    // Avatar circle
    const av = x + 16 + ORG_AVATAR_R
    const avY = y + ORG_NODE_H / 2
    ctx.save()
    ctx.beginPath()
    ctx.arc(av, avY, ORG_AVATAR_R, 0, Math.PI * 2)
    ctx.fillStyle = avatarColor(contact.name)
    ctx.fill()
    ctx.restore()

    // Avatar initials
    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold 13px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(contact.name), av, avY)
    ctx.restore()

    // Text area
    const tx = av + ORG_AVATAR_R + 10
    const maxTw = ORG_NODE_W - (tx - x) - 10

    // Name
    ctx.save()
    ctx.fillStyle = '#1e293b'
    ctx.font = `bold 13px sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(fitText(ctx, contact.name, maxTw), tx, y + 28)
    ctx.restore()

    // Title
    if (contact.title) {
      ctx.save()
      ctx.fillStyle = '#64748b'
      ctx.font = `12px sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(fitText(ctx, contact.title, maxTw), tx, y + 47)
      ctx.restore()
    }

    // Level badge
    if (contact.level) {
      const badgeLabel = LEVEL_LABELS[contact.level] ?? contact.level.toUpperCase()
      ctx.save()
      ctx.fillStyle = '#3b82f6'
      ctx.font = `bold 9px sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(badgeLabel.toUpperCase(), tx, y + 66)
      ctx.restore()
    }
  }

  return canvas
}

// ─── Timeline Gantt canvas renderer ──────────────────────────────────────────

const TL_LABEL_W = 160
const TL_RULER_H = 44   // header area height
const TL_LANE_H  = 36   // height per lane row
const TL_BAR_H   = 22
const TL_PAD_L   = 0
const TL_COL_BORDER = '#e2e8f0'
const TL_COL_BG    = '#ffffff'
const TL_COL_TODAY = '#6366f1'

export function drawGantt(timeline: Timeline): HTMLCanvasElement {
  const start  = parseDate(timeline.startDate)
  const end    = parseDate(timeline.endDate)
  const days   = diffDays(start, end)
  if (days <= 0) {
    const c = document.createElement('canvas')
    c.width = 600; c.height = 200
    return c
  }

  // Column system: use weeks or months for a clean export layout
  // Pick a sensible px-per-day based on timescale
  const pxPerDay = timeline.colWidth ?? PX_PER_DAY[timeline.timescale]

  // Build column groups (month or week buckets for the ruler)
  interface ColGroup { label: string; startDay: number; widthPx: number }
  const groups: ColGroup[] = []
  const cur = new Date(start)
  cur.setDate(1) // snap to month start
  while (cur < end) {
    const groupStart = new Date(Math.max(cur.getTime(), start.getTime()))
    const groupEnd   = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    const clampedEnd = new Date(Math.min(groupEnd.getTime(), end.getTime()))
    const d0 = diffDays(start, groupStart)
    const d1 = diffDays(start, clampedEnd)
    const label = groupStart.toLocaleString('default', { month: 'short', year: '2-digit' })
    groups.push({ label, startDay: d0, widthPx: (d1 - d0) * pxPerDay })
    cur.setMonth(cur.getMonth() + 1)
  }

  const totalW  = days * pxPerDay
  // Lane count: count non-collapsed lanes + bars in them
  const laneCount = timeline.swimLanes.length
  const barCounts = timeline.swimLanes.map(lane =>
    timeline.items.filter(i => i.swimLaneId === lane.id && i.type === 'bar').length
  )
  const totalRows = laneCount + barCounts.reduce((a, b) => a + b, 0)
  const canvasW = TL_LABEL_W + TL_PAD_L + totalW
  const canvasH = TL_RULER_H + totalRows * TL_LANE_H + 20

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width  = canvasW  * scale
  canvas.height = canvasH * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  // Background
  ctx.fillStyle = TL_COL_BG
  ctx.fillRect(0, 0, canvasW, canvasH)

  // ── Ruler ──────────────────────────────────────────────────────────────────

  // Ruler background
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(0, 0, canvasW, TL_RULER_H)

  // Label area header
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, 0, TL_LABEL_W, TL_RULER_H)
  ctx.strokeStyle = TL_COL_BORDER; ctx.lineWidth = 1
  ctx.strokeRect(0, 0, TL_LABEL_W, TL_RULER_H)

  ctx.save()
  ctx.fillStyle = '#64748b'
  ctx.font = 'bold 10px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(timeline.name, 8, TL_RULER_H / 2)
  ctx.restore()

  // Month group headers
  for (const g of groups) {
    const gx = TL_LABEL_W + g.startDay * pxPerDay
    // Border
    ctx.strokeStyle = TL_COL_BORDER; ctx.lineWidth = 1
    ctx.strokeRect(gx, 0, g.widthPx, TL_RULER_H)
    // Label
    ctx.save()
    ctx.fillStyle = '#475569'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    const padLabel = fitText(ctx, g.label, g.widthPx - 8)
    ctx.fillText(padLabel, gx + 6, TL_RULER_H / 2)
    ctx.restore()
  }

  // Today line
  const todayDays = diffDays(start, new Date())
  if (todayDays > 0 && todayDays < days) {
    const todayX = TL_LABEL_W + todayDays * pxPerDay
    ctx.save()
    ctx.strokeStyle = TL_COL_TODAY
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(todayX, 0); ctx.lineTo(todayX, canvasH)
    ctx.stroke()
    ctx.restore()
  }

  // ── Lanes & bars ────────────────────────────────────────────────────────────

  let rowY = TL_RULER_H

  function dateToPx(d: string): number {
    const date = parseDate(d)
    return Math.max(0, diffDays(start, date)) * pxPerDay
  }

  for (const lane of timeline.swimLanes) {
    const items = timeline.items.filter(i => i.swimLaneId === lane.id && i.type === 'bar')

    // Lane header row
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, rowY, canvasW, TL_LANE_H)
    ctx.strokeStyle = TL_COL_BORDER; ctx.lineWidth = 1
    ctx.strokeRect(0, rowY, canvasW, TL_LANE_H)

    // Lane color dot
    ctx.beginPath()
    ctx.arc(12, rowY + TL_LANE_H / 2, 5, 0, Math.PI * 2)
    ctx.fillStyle = lane.color
    ctx.fill()

    // Lane label
    ctx.save()
    ctx.fillStyle = '#334155'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(fitText(ctx, lane.label.toUpperCase(), TL_LABEL_W - 28), 24, rowY + TL_LANE_H / 2)
    ctx.restore()

    // Vertical grid line at label edge
    ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(TL_LABEL_W, rowY); ctx.lineTo(TL_LABEL_W, rowY + TL_LANE_H); ctx.stroke()

    rowY += TL_LANE_H

    // Bar rows
    for (const item of items) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, rowY, canvasW, TL_LANE_H)
      ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 1
      ctx.strokeRect(0, rowY, canvasW, TL_LANE_H)

      // Task label
      ctx.save()
      ctx.fillStyle = '#475569'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(fitText(ctx, item.label, TL_LABEL_W - 16), 20, rowY + TL_LANE_H / 2)
      ctx.restore()

      // Vertical grid line
      ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(TL_LABEL_W, rowY); ctx.lineTo(TL_LABEL_W, rowY + TL_LANE_H); ctx.stroke()

      // Bar
      const bx = TL_LABEL_W + dateToPx(item.startDate)
      const bw = Math.max(4, dateToPx(item.endDate) - dateToPx(item.startDate))
      const bY = rowY + (TL_LANE_H - TL_BAR_H) / 2

      ctx.save()
      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.12)'
      ctx.shadowBlur = 4
      ctx.shadowOffsetY = 1
      ctx.fillStyle = item.color
      roundRect(ctx, bx, bY, bw, TL_BAR_H, 5)
      ctx.fill()
      ctx.restore()

      // Progress overlay
      if (item.progress > 0) {
        ctx.save()
        ctx.globalAlpha = 0.25
        ctx.fillStyle = '#000000'
        const pw = bw * (item.progress / 100)
        roundRect(ctx, bx, bY, pw, TL_BAR_H, 5)
        ctx.fill()
        ctx.restore()
      }

      // Bar label
      if (bw > 30) {
        ctx.save()
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 9px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0,0,0,0.4)'
        ctx.shadowBlur = 2
        const barLabel = fitText(ctx, item.label, bw - 8)
        ctx.fillText(barLabel, bx + 4, bY + TL_BAR_H / 2)
        ctx.restore()
      }

      rowY += TL_LANE_H
    }
  }

  // ── Milestones ─────────────────────────────────────────────────────────────
  for (const m of timeline.milestones) {
    const mx = TL_LABEL_W + dateToPx(m.date)
    if (mx < TL_LABEL_W || mx > canvasW) continue
    // Diamond
    const my = TL_RULER_H / 2
    const r  = 7
    ctx.save()
    ctx.fillStyle = m.color
    ctx.beginPath()
    ctx.moveTo(mx, my - r); ctx.lineTo(mx + r, my); ctx.lineTo(mx, my + r); ctx.lineTo(mx - r, my)
    ctx.closePath(); ctx.fill()
    ctx.restore()
    // Vertical line
    ctx.save()
    ctx.strokeStyle = m.color
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.5
    ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(mx, TL_RULER_H); ctx.lineTo(mx, canvasH)
    ctx.stroke()
    ctx.restore()
    // Label
    ctx.save()
    ctx.fillStyle = m.color
    ctx.font = 'bold 9px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(m.label, mx, my - r - 3)
    ctx.restore()
  }

  // Bottom border
  ctx.strokeStyle = TL_COL_BORDER; ctx.lineWidth = 1
  ctx.strokeRect(0, 0, canvasW, canvasH)

  return canvas
}

// ─── Convert canvas to data URL ───────────────────────────────────────────────

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

// ─── ExcelJS download helper ─────────────────────────────────────────────────

async function downloadXLSX(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function addSheetFromRows(wb: ExcelJS.Workbook, sheetName: string, rows: string[][]) {
  const ws = wb.addWorksheet(sheetName)
  if (rows.length > 0) {
    ws.addRow(rows[0]).font = { bold: true }
    for (const row of rows.slice(1)) ws.addRow(row)
    ws.columns.forEach((col, i) => {
      const maxLen = rows.reduce((m, r) => Math.max(m, (r[i] ?? '').length), 0)
      col.width = Math.min(40, Math.max(10, maxLen + 2))
    })
  }
  return ws
}

// ─── Add image from canvas to PDF ────────────────────────────────────────────

function addCanvasToPDF(doc: jsPDF, canvas: HTMLCanvasElement, title?: string) {
  const dataUrl  = canvasToDataUrl(canvas)
  const pageW    = doc.internal.pageSize.getWidth()
  const pageH    = doc.internal.pageSize.getHeight()
  const marginT  = title ? 20 : 10
  const imgW     = canvas.width  / 2   // undo the 2x scale
  const imgH     = canvas.height / 2
  const scale    = Math.min((pageW - 20) / imgW, (pageH - marginT - 10) / imgH)
  if (title) { doc.setFontSize(12); doc.text(title, 10, 13) }
  doc.addImage(dataUrl, 'PNG', 10, marginT, imgW * scale, imgH * scale)
}

// ─── Add image from canvas to PPTX ───────────────────────────────────────────

function addCanvasToPPTX(slide: PptxGenJS.Slide, canvas: HTMLCanvasElement, title?: string) {
  const dataUrl = canvasToDataUrl(canvas)
  const imgW    = canvas.width  / 2
  const imgH    = canvas.height / 2
  const maxW    = 9.4
  const maxH    = title ? 6.3 : 6.8
  const startY  = title ? 0.7 : 0.2
  const scale   = Math.min(maxW / imgW, maxH / imgH)
  if (title) slide.addText(title, { x: 0.3, y: 0.1, w: 9.4, h: 0.5, fontSize: 14, bold: true, color: '1e293b' })
  slide.addImage({ data: dataUrl, x: 0.3, y: startY, w: imgW * scale, h: imgH * scale })
}

// ─── Timeline helpers ─────────────────────────────────────────────────────────

function buildTimelineRows(timeline: Timeline): string[][] {
  const rows: string[][] = [['Type', 'Lane', 'Name', 'Start', 'End/Date', 'Progress%', 'Notes']]
  for (const m of timeline.milestones) {
    rows.push(['milestone', '', m.label, m.date, m.date, '', ''])
  }
  for (const lane of timeline.swimLanes) {
    const items = timeline.items.filter(i => i.swimLaneId === lane.id)
    for (const item of items) {
      rows.push(['task', lane.label, item.label, item.startDate, item.endDate, String(item.progress), item.notes ?? ''])
      for (const sub of item.subItems ?? []) {
        rows.push(['subtask', lane.label, `  └ ${sub.label}`, sub.startDate, sub.endDate, String(sub.progress), ''])
      }
    }
  }
  return rows
}

// ─── Timeline exports ─────────────────────────────────────────────────────────

export function exportTimelineCSV(timeline: Timeline, _mode: 'gantt' | 'table' | 'both'): void {
  downloadCSV(buildTimelineRows(timeline), `${timeline.name}.csv`)
}

export async function exportTimelineXLSX(
  timeline: Timeline,
  mode: 'gantt' | 'table' | 'both',
): Promise<void> {
  const wb = new ExcelJS.Workbook()

  if (mode === 'gantt' || mode === 'both') {
    const canvas  = drawGantt(timeline)
    const dataUrl = canvasToDataUrl(canvas)
    const base64  = dataUrl.split(',')[1]
    const imgSheet = wb.addWorksheet('Gantt')
    const imageId  = wb.addImage({ base64, extension: 'png' })
    const imgW = canvas.width  / 2
    const imgH = canvas.height / 2
    imgSheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: imgW, height: imgH } })
    imgSheet.columns = Array(Math.ceil(imgW / 64)).fill({ width: 9 })
    imgSheet.getRow(1).height = imgH * 0.75   // approximate row height in pts
  }

  if (mode === 'table' || mode === 'both') {
    addSheetFromRows(wb, 'Timeline Data', buildTimelineRows(timeline))
  }

  if (mode === 'gantt' && false) {   // never falls through — gantt always has canvas
    addSheetFromRows(wb, 'Timeline Data', buildTimelineRows(timeline))
  }

  await downloadXLSX(wb, `${timeline.name}.xlsx`)
}

export async function exportTimelinePDF(
  timeline: Timeline,
  mode: 'gantt' | 'table' | 'both',
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape' })

  if (mode === 'gantt' || mode === 'both') {
    const canvas = drawGantt(timeline)
    addCanvasToPDF(doc, canvas, timeline.name)
    if (mode === 'both') doc.addPage()
  }

  if (mode === 'table' || mode === 'both') {
    const rows = buildTimelineRows(timeline)
    if (mode !== 'both') { doc.setFontSize(12); doc.text(timeline.name, 14, 13) }
    autoTable(doc, {
      head: [rows[0]], body: rows.slice(1),
      startY: mode === 'both' ? 10 : 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [99, 102, 241] },
    })
  }

  doc.save(`${timeline.name}.pdf`)
}

export async function exportTimelinePPTX(
  timeline: Timeline,
  mode: 'gantt' | 'table' | 'both',
): Promise<void> {
  const pptx = new PptxGenJS()

  if (mode === 'gantt' || mode === 'both') {
    const canvas = drawGantt(timeline)
    const slide  = pptx.addSlide()
    addCanvasToPPTX(slide, canvas, timeline.name)
  }

  if (mode === 'table' || mode === 'both') {
    for (const lane of timeline.swimLanes) {
      const items = timeline.items.filter(i => i.swimLaneId === lane.id)
      if (items.length === 0) continue
      const slide  = pptx.addSlide()
      slide.addText(lane.label, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })
      const header: PptxGenJS.TableRow = ['Name','Start','End','Progress%','Notes'].map(t => ({ text: t, options: { bold: true } }))
      const body: PptxGenJS.TableRow[] = []
      for (const item of items) {
        body.push([{ text: item.label }, { text: item.startDate }, { text: item.endDate }, { text: String(item.progress) }, { text: item.notes ?? '' }])
        for (const sub of item.subItems ?? []) {
          body.push([{ text: `  └ ${sub.label}` }, { text: sub.startDate }, { text: sub.endDate }, { text: String(sub.progress) }, { text: '' }])
        }
      }
      slide.addTable([header, ...body], { x: 0.5, y: 1.0, w: 9, fontSize: 10, colW: [3, 1.2, 1.2, 1.0, 2.6], border: { pt: 0.5, color: '#e2e8f0' }, autoPage: true })
    }
  }

  await pptx.writeFile({ fileName: `${timeline.name}.pptx` })
}

// ─── Contact helpers ──────────────────────────────────────────────────────────

function buildContactRows(contacts: Contact[]): string[][] {
  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })
  const rows: string[][] = [['Name', 'Title', 'Org', 'Level', 'Email', 'Phone', 'ReportsTo']]
  for (const c of contacts) {
    rows.push([c.name, c.title ?? '', c.org ?? '', c.level ?? '', c.email ?? '', c.phone ?? '', c.parentId ? (idToName[c.parentId] ?? '') : ''])
  }
  return rows
}

// ─── Contact exports ──────────────────────────────────────────────────────────

export function exportContactsCSV(contacts: Contact[]): void {
  downloadCSV(buildContactRows(contacts), 'contacts.csv')
}

export async function exportContactsXLSX(contacts: Contact[], orgData: OrgChartData): Promise<void> {
  const wb = new ExcelJS.Workbook()
  if (orgData.contacts.length > 0) {
    const canvas  = drawOrgChart(orgData)
    const dataUrl = canvasToDataUrl(canvas)
    const base64  = dataUrl.split(',')[1]
    const imgSheet = wb.addWorksheet('Org Chart')
    const imageId  = wb.addImage({ base64, extension: 'png' })
    const imgW = canvas.width  / 2
    const imgH = canvas.height / 2
    imgSheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: imgW, height: imgH } })
    imgSheet.columns = Array(Math.ceil(imgW / 64)).fill({ width: 9 })
    imgSheet.getRow(1).height = imgH * 0.75
  }
  addSheetFromRows(wb, 'Contacts', buildContactRows(contacts))
  await downloadXLSX(wb, 'org-chart.xlsx')
}

export async function exportContactsPDF(contacts: Contact[], orgData: OrgChartData): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape' })
  if (orgData.contacts.length > 0) {
    const canvas = drawOrgChart(orgData)
    addCanvasToPDF(doc, canvas, 'Org Chart')
    doc.addPage()
  }
  const rows = buildContactRows(contacts)
  doc.setFontSize(14); doc.text('Contacts', 14, 13)
  autoTable(doc, { head: [rows[0]], body: rows.slice(1), startY: 20, styles: { fontSize: 8 }, headStyles: { fillColor: [99, 102, 241] } })
  doc.save('org-chart.pdf')
}

export async function exportContactsPPTX(contacts: Contact[], orgData: OrgChartData): Promise<void> {
  const pptx = new PptxGenJS()

  if (orgData.contacts.length > 0) {
    const canvas = drawOrgChart(orgData)
    const slide  = pptx.addSlide()
    addCanvasToPPTX(slide, canvas, 'Org Chart')
  }

  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })
  const sorted = [...contacts].sort((a, b) => {
    const lo: Record<string, number> = { 'c-level': 0, gm: 1, 'head-of': 2, director: 3, manager: 4, lead: 5, individual: 6 }
    return (lo[a.level ?? 'individual'] ?? 99) - (lo[b.level ?? 'individual'] ?? 99) || a.name.localeCompare(b.name)
  })
  const slide  = pptx.addSlide()
  slide.addText('Contacts', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })
  const header: PptxGenJS.TableRow = ['Name','Title','Org','Level','Email','Phone','ReportsTo'].map(t => ({ text: t, options: { bold: true } }))
  const body: PptxGenJS.TableRow[] = sorted.map(c => [
    { text: c.name }, { text: c.title ?? '' }, { text: c.org ?? '' }, { text: c.level ?? '' },
    { text: c.email ?? '' }, { text: c.phone ?? '' },
    { text: c.parentId ? (idToName[c.parentId] ?? '') : '' },
  ])
  slide.addTable([header, ...body], { x: 0.5, y: 1.0, w: 9, fontSize: 9, colW: [1.5, 1.5, 1.2, 1.0, 1.5, 1.0, 1.3], border: { pt: 0.5, color: '#e2e8f0' }, autoPage: true })
  await pptx.writeFile({ fileName: 'org-chart.pptx' })
}

// ─── Task helpers ─────────────────────────────────────────────────────────────

function buildTaskRows(taskBuckets: TaskBucket[]): string[][] {
  const rows: string[][] = [['Bucket', 'Task', 'Priority', 'Start', 'Due', 'Progress%', 'Done', 'Notes', 'Subtask']]
  for (const bucket of taskBuckets) {
    for (const task of bucket.tasks) {
      rows.push([bucket.name, task.text, task.priority ?? '', task.startDate ?? '', task.due ?? '', String(task.progress ?? 0), '', task.notes ?? '', ''])
      for (const sub of task.subTasks ?? []) {
        rows.push([bucket.name, task.text, '', '', sub.due ?? '', String(sub.progress ?? 0), sub.done ? 'yes' : '', sub.notes ?? '', sub.text])
      }
    }
  }
  return rows
}

// ─── Task exports ─────────────────────────────────────────────────────────────

export function exportTasksCSV(taskBuckets: TaskBucket[]): void {
  downloadCSV(buildTaskRows(taskBuckets), 'tasks.csv')
}

export async function exportTasksXLSX(taskBuckets: TaskBucket[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  addSheetFromRows(wb, 'Tasks', buildTaskRows(taskBuckets))
  await downloadXLSX(wb, 'tasks.xlsx')
}

export function exportTasksPDF(taskBuckets: TaskBucket[]): void {
  const rows = buildTaskRows(taskBuckets)
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14); doc.text('Tasks', 14, 13)
  autoTable(doc, { head: [rows[0]], body: rows.slice(1), startY: 20, styles: { fontSize: 8 }, headStyles: { fillColor: [99, 102, 241] } })
  doc.save('tasks.pdf')
}

export async function exportTasksPPTX(taskBuckets: TaskBucket[]): Promise<void> {
  const pptx = new PptxGenJS()
  for (const bucket of taskBuckets) {
    if (bucket.tasks.length === 0) continue
    const slide = pptx.addSlide()
    slide.addText(bucket.name, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })
    const header: PptxGenJS.TableRow = ['Task','Priority','Start','Due','Progress%','Done','Notes'].map(t => ({ text: t, options: { bold: true } }))
    const body: PptxGenJS.TableRow[] = []
    for (const task of bucket.tasks) {
      body.push([{ text: task.text }, { text: task.priority ?? '' }, { text: task.startDate ?? '' }, { text: task.due ?? '' }, { text: String(task.progress ?? 0) }, { text: '' }, { text: task.notes ?? '' }])
      for (const sub of task.subTasks ?? []) {
        body.push([{ text: `  └ ${sub.text}` }, { text: '' }, { text: '' }, { text: sub.due ?? '' }, { text: String(sub.progress ?? 0) }, { text: sub.done ? 'yes' : '' }, { text: sub.notes ?? '' }])
      }
    }
    slide.addTable([header, ...body], { x: 0.5, y: 1.0, w: 9, fontSize: 10, colW: [2.5, 0.9, 1.0, 1.0, 1.0, 0.7, 1.9], border: { pt: 0.5, color: '#e2e8f0' }, autoPage: true })
  }
  await pptx.writeFile({ fileName: 'tasks.pptx' })
}
