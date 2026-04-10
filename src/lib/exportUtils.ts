import type { Timeline, Contact, TaskBucket } from '../types'
import { downloadCSV } from './utils'
import ExcelJS from 'exceljs'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import PptxGenJS from 'pptxgenjs'
import html2canvas from 'html2canvas'

// ─── Visual capture helper ────────────────────────────────────────────────────

/** Render a DOM element to a canvas, returning a base64 PNG data URL.
 *  html2canvas renders the element at its full natural size regardless of scroll. */
async function captureElement(el: HTMLElement): Promise<string> {
  const canvas = await html2canvas(el, {
    scale: 2,           // 2× for retina sharpness
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    // Expand to full scroll dimensions so nothing is clipped
    width: el.scrollWidth,
    height: el.scrollHeight,
    windowWidth: el.scrollWidth,
    windowHeight: el.scrollHeight,
  })
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
    // Auto-width columns
    ws.columns.forEach((col, i) => {
      const maxLen = rows.reduce((m, r) => Math.max(m, (r[i] ?? '').length), 0)
      col.width = Math.min(40, Math.max(10, maxLen + 2))
    })
  }
  return ws
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
      rows.push([
        'task',
        lane.label,
        item.label,
        item.startDate,
        item.endDate,
        String(item.progress),
        item.notes ?? '',
      ])
      for (const sub of item.subItems ?? []) {
        rows.push([
          'subtask',
          lane.label,
          `  \u2514 ${sub.label}`,
          sub.startDate,
          sub.endDate,
          String(sub.progress),
          '',
        ])
      }
    }
  }

  return rows
}

// ─── Timeline exports ─────────────────────────────────────────────────────────

export function exportTimelineCSV(timeline: Timeline, _mode: 'gantt' | 'table' | 'both'): void {
  // CSV can only represent tabular data — always export table
  downloadCSV(buildTimelineRows(timeline), `${timeline.name}.csv`)
}

export async function exportTimelineXLSX(
  timeline: Timeline,
  mode: 'gantt' | 'table' | 'both',
  ganttEl?: HTMLElement | null,
): Promise<void> {
  const wb = new ExcelJS.Workbook()

  // Gantt image sheet
  if ((mode === 'gantt' || mode === 'both') && ganttEl) {
    const dataUrl = await captureElement(ganttEl)
    const base64 = dataUrl.split(',')[1]
    const imgSheet = wb.addWorksheet('Gantt')
    const imageId = wb.addImage({ base64, extension: 'png' })
    // Rough column width estimate from pixel dimensions
    const imgWidth = ganttEl.scrollWidth
    const imgHeight = ganttEl.scrollHeight
    const colW = Math.max(10, Math.round(imgWidth / 7))
    const rowH = Math.max(15, Math.round(imgHeight / 20))
    imgSheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: imgWidth, height: imgHeight } })
    imgSheet.columns = Array(10).fill({ width: colW })
    imgSheet.getRow(1).height = rowH
  }

  // Table sheet
  if (mode === 'table' || mode === 'both') {
    addSheetFromRows(wb, 'Timeline Data', buildTimelineRows(timeline))
  }

  // If gantt-only with no element, fall back to table
  if (mode === 'gantt' && !ganttEl) {
    addSheetFromRows(wb, 'Timeline Data', buildTimelineRows(timeline))
  }

  await downloadXLSX(wb, `${timeline.name}.xlsx`)
}

export async function exportTimelinePDF(
  timeline: Timeline,
  mode: 'gantt' | 'table' | 'both',
  ganttEl?: HTMLElement | null,
): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape' })

  if ((mode === 'gantt' || mode === 'both') && ganttEl) {
    const dataUrl = await captureElement(ganttEl)
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const imgW = ganttEl.scrollWidth
    const imgH = ganttEl.scrollHeight
    const scale = Math.min((pageW - 20) / imgW, (pageH - 20) / imgH)
    const drawW = imgW * scale
    const drawH = imgH * scale
    doc.setFontSize(12)
    doc.text(timeline.name, 10, 10)
    doc.addImage(dataUrl, 'PNG', 10, 16, drawW, drawH)
    if (mode === 'both') doc.addPage()
  }

  if (mode === 'table' || mode === 'both' || !ganttEl) {
    const rows = buildTimelineRows(timeline)
    if (mode !== 'gantt' || !ganttEl) {
      doc.setFontSize(12)
      doc.text(timeline.name, 14, 16)
    }
    autoTable(doc, {
      head: [rows[0]], body: rows.slice(1),
      startY: (mode === 'both') ? 20 : 22,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [99, 102, 241] },
    })
  }

  doc.save(`${timeline.name}.pdf`)
}

export async function exportTimelinePPTX(
  timeline: Timeline,
  mode: 'gantt' | 'table' | 'both',
  ganttEl?: HTMLElement | null,
): Promise<void> {
  const pptx = new PptxGenJS()

  // Gantt image slide
  if ((mode === 'gantt' || mode === 'both') && ganttEl) {
    const dataUrl = await captureElement(ganttEl)
    const slide = pptx.addSlide()
    slide.addText(timeline.name, { x: 0.3, y: 0.1, w: 9.4, h: 0.4, fontSize: 14, bold: true })
    // Fit image to slide (10 × 7.5 inches)
    const imgW = ganttEl.scrollWidth
    const imgH = ganttEl.scrollHeight
    const maxW = 9.4, maxH = 6.8
    const scale = Math.min(maxW / imgW, maxH / imgH)
    slide.addImage({ data: dataUrl, x: 0.3, y: 0.6, w: imgW * scale, h: imgH * scale })
  }

  // Table slides per lane
  if (mode === 'table' || mode === 'both' || !ganttEl) {
    for (const lane of timeline.swimLanes) {
      const items = timeline.items.filter(i => i.swimLaneId === lane.id)
      if (items.length === 0) continue
      const slide = pptx.addSlide()
      slide.addText(lane.label, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })
      const header: PptxGenJS.TableRow = ['Name','Start','End','Progress%','Notes']
        .map(t => ({ text: t, options: { bold: true } }))
      const body: PptxGenJS.TableRow[] = []
      for (const item of items) {
        body.push([
          { text: item.label }, { text: item.startDate }, { text: item.endDate },
          { text: String(item.progress) }, { text: item.notes ?? '' },
        ])
        for (const sub of item.subItems ?? []) {
          body.push([
            { text: `  \u2514 ${sub.label}` }, { text: sub.startDate }, { text: sub.endDate },
            { text: String(sub.progress) }, { text: '' },
          ])
        }
      }
      slide.addTable([header, ...body], {
        x: 0.5, y: 1.0, w: 9, fontSize: 10,
        colW: [3, 1.2, 1.2, 1.0, 2.6],
        border: { pt: 0.5, color: '#e2e8f0' }, autoPage: true,
      })
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
    rows.push([
      c.name, c.title ?? '', c.org ?? '', c.level ?? '',
      c.email ?? '', c.phone ?? '',
      c.parentId ? (idToName[c.parentId] ?? '') : '',
    ])
  }
  return rows
}

// ─── Contact exports ──────────────────────────────────────────────────────────

export function exportContactsCSV(contacts: Contact[]): void {
  downloadCSV(buildContactRows(contacts), 'contacts.csv')
}

export async function exportContactsXLSX(contacts: Contact[], chartEl?: HTMLElement | null): Promise<void> {
  const wb = new ExcelJS.Workbook()
  if (chartEl) {
    const dataUrl = await captureElement(chartEl)
    const base64 = dataUrl.split(',')[1]
    const imgSheet = wb.addWorksheet('Org Chart')
    const imageId = wb.addImage({ base64, extension: 'png' })
    imgSheet.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: chartEl.scrollWidth, height: chartEl.scrollHeight } })
    imgSheet.columns = Array(10).fill({ width: 20 })
    imgSheet.getRow(1).height = Math.max(15, Math.round(chartEl.scrollHeight / 20))
  }
  addSheetFromRows(wb, 'Contacts', buildContactRows(contacts))
  await downloadXLSX(wb, 'org-chart.xlsx')
}

export async function exportContactsPDF(contacts: Contact[], chartEl?: HTMLElement | null): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape' })
  if (chartEl) {
    const dataUrl = await captureElement(chartEl)
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const scale = Math.min((pageW - 20) / chartEl.scrollWidth, (pageH - 20) / chartEl.scrollHeight)
    doc.setFontSize(12)
    doc.text('Org Chart', 10, 10)
    doc.addImage(dataUrl, 'PNG', 10, 16, chartEl.scrollWidth * scale, chartEl.scrollHeight * scale)
    doc.addPage()
  }
  const rows = buildContactRows(contacts)
  doc.setFontSize(14)
  doc.text('Contacts', 14, 16)
  autoTable(doc, {
    head: [rows[0]], body: rows.slice(1),
    startY: 22, styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
  })
  doc.save('org-chart.pdf')
}

export async function exportContactsPPTX(contacts: Contact[], chartEl?: HTMLElement | null): Promise<void> {
  const pptx = new PptxGenJS()

  // Visual chart slide
  if (chartEl) {
    const dataUrl = await captureElement(chartEl)
    const slide = pptx.addSlide()
    slide.addText('Org Chart', { x: 0.3, y: 0.1, w: 9.4, h: 0.4, fontSize: 14, bold: true })
    const maxW = 9.4, maxH = 6.8
    const scale = Math.min(maxW / chartEl.scrollWidth, maxH / chartEl.scrollHeight)
    slide.addImage({ data: dataUrl, x: 0.3, y: 0.6, w: chartEl.scrollWidth * scale, h: chartEl.scrollHeight * scale })
  }

  // Contact list slide
  const sorted = [...contacts].sort((a, b) => {
    const lo: Record<string, number> = { 'c-level': 0, gm: 1, 'head-of': 2, director: 3, manager: 4, lead: 5, individual: 6 }
    return (lo[a.level ?? 'individual'] ?? 99) - (lo[b.level ?? 'individual'] ?? 99) || a.name.localeCompare(b.name)
  })
  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })

  const slide = pptx.addSlide()
  slide.addText('Contacts', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })
  const header: PptxGenJS.TableRow = ['Name','Title','Org','Level','Email','Phone','ReportsTo']
    .map(t => ({ text: t, options: { bold: true } }))
  const body: PptxGenJS.TableRow[] = sorted.map(c => [
    { text: c.name }, { text: c.title ?? '' }, { text: c.org ?? '' }, { text: c.level ?? '' },
    { text: c.email ?? '' }, { text: c.phone ?? '' },
    { text: c.parentId ? (idToName[c.parentId] ?? '') : '' },
  ])
  slide.addTable([header, ...body], {
    x: 0.5, y: 1.0, w: 9, fontSize: 9,
    colW: [1.5, 1.5, 1.2, 1.0, 1.5, 1.0, 1.3],
    border: { pt: 0.5, color: '#e2e8f0' }, autoPage: true,
  })
  await pptx.writeFile({ fileName: 'org-chart.pptx' })
}

// ─── Task helpers ─────────────────────────────────────────────────────────────

function buildTaskRows(taskBuckets: TaskBucket[]): string[][] {
  const rows: string[][] = [['Bucket', 'Task', 'Priority', 'Start', 'Due', 'Progress%', 'Done', 'Notes', 'Subtask']]
  for (const bucket of taskBuckets) {
    for (const task of bucket.tasks) {
      rows.push([
        bucket.name, task.text, task.priority ?? '',
        task.startDate ?? '', task.due ?? '',
        String(task.progress ?? 0), '', task.notes ?? '', '',
      ])
      for (const sub of task.subTasks ?? []) {
        rows.push([
          bucket.name, task.text, '',
          '', sub.due ?? '',
          String(sub.progress ?? 0), sub.done ? 'yes' : '', sub.notes ?? '', sub.text,
        ])
      }
    }
  }
  return rows
}

// ─── Task exports ─────────────────────────────────────────────────────────────

export function exportTasksCSV(taskBuckets: TaskBucket[]): void {
  downloadCSV(buildTaskRows(taskBuckets), 'tasks.csv')
}

export function exportTasksXLSX(taskBuckets: TaskBucket[]): void {
  const wb = new ExcelJS.Workbook()
  addSheetFromRows(wb, 'Tasks', buildTaskRows(taskBuckets))
  downloadXLSX(wb, 'tasks.xlsx')
}

export function exportTasksPDF(taskBuckets: TaskBucket[]): void {
  const rows = buildTaskRows(taskBuckets)
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text('Tasks', 14, 16)
  autoTable(doc, {
    head: [rows[0]], body: rows.slice(1),
    startY: 22, styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
  })
  doc.save('tasks.pdf')
}

export function exportTasksPPTX(taskBuckets: TaskBucket[]): void {
  const pptx = new PptxGenJS()
  for (const bucket of taskBuckets) {
    if (bucket.tasks.length === 0) continue
    const slide = pptx.addSlide()
    slide.addText(bucket.name, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })

    const header: PptxGenJS.TableRow = ['Task','Priority','Start','Due','Progress%','Done','Notes']
      .map(t => ({ text: t, options: { bold: true } }))

    const body: PptxGenJS.TableRow[] = []
    for (const task of bucket.tasks) {
      body.push([
        { text: task.text }, { text: task.priority ?? '' },
        { text: task.startDate ?? '' }, { text: task.due ?? '' },
        { text: String(task.progress ?? 0) }, { text: '' }, { text: task.notes ?? '' },
      ])
      for (const sub of task.subTasks ?? []) {
        body.push([
          { text: `  \u2514 ${sub.text}` }, { text: '' }, { text: '' },
          { text: sub.due ?? '' }, { text: String(sub.progress ?? 0) },
          { text: sub.done ? 'yes' : '' }, { text: sub.notes ?? '' },
        ])
      }
    }

    slide.addTable([header, ...body], {
      x: 0.5, y: 1.0, w: 9, fontSize: 10,
      colW: [2.5, 0.9, 1.0, 1.0, 1.0, 0.7, 1.9],
      border: { pt: 0.5, color: '#e2e8f0' },
      autoPage: true,
    })
  }
  pptx.writeFile({ fileName: 'tasks.pptx' })
}
