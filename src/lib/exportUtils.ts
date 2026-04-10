import type { Timeline, Contact, TaskBucket } from '../types'
import { downloadCSV } from './utils'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import PptxGenJS from 'pptxgenjs'

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
  const rows = buildTimelineRows(timeline)
  downloadCSV(rows, `${timeline.name}.csv`)
}

export function exportTimelineXLSX(timeline: Timeline, _mode: 'gantt' | 'table' | 'both'): void {
  const rows = buildTimelineRows(timeline)
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Timeline')
  XLSX.writeFile(wb, `${timeline.name}.xlsx`)
}

export function exportTimelinePDF(timeline: Timeline, _mode: 'gantt' | 'table' | 'both'): void {
  const rows = buildTimelineRows(timeline)
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text(timeline.name, 14, 16)
  autoTable(doc, {
    head: [rows[0]],
    body: rows.slice(1),
    startY: 22,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
  })
  doc.save(`${timeline.name}.pdf`)
}

export function exportTimelinePPTX(timeline: Timeline, _mode: 'gantt' | 'table' | 'both'): void {
  const pptx = new PptxGenJS()

  for (const lane of timeline.swimLanes) {
    const items = timeline.items.filter(i => i.swimLaneId === lane.id)
    if (items.length === 0) continue

    const slide = pptx.addSlide()
    slide.addText(lane.label, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })

    const header: PptxGenJS.TableRow = [
      { text: 'Name', options: { bold: true } },
      { text: 'Start', options: { bold: true } },
      { text: 'End', options: { bold: true } },
      { text: 'Progress%', options: { bold: true } },
      { text: 'Notes', options: { bold: true } },
    ]

    const body: PptxGenJS.TableRow[] = []
    for (const item of items) {
      body.push([
        { text: item.label },
        { text: item.startDate },
        { text: item.endDate },
        { text: String(item.progress) },
        { text: item.notes ?? '' },
      ])
      for (const sub of item.subItems ?? []) {
        body.push([
          { text: `  \u2514 ${sub.label}` },
          { text: sub.startDate },
          { text: sub.endDate },
          { text: String(sub.progress) },
          { text: '' },
        ])
      }
    }

    slide.addTable([header, ...body], {
      x: 0.5, y: 1.0, w: 9,
      fontSize: 10,
      colW: [3, 1.2, 1.2, 1.0, 2.6],
      border: { pt: 0.5, color: '#e2e8f0' },
      autoPage: true,
    })
  }

  pptx.writeFile({ fileName: `${timeline.name}.pptx` })
}

// ─── Contact helpers ──────────────────────────────────────────────────────────

function buildContactRows(contacts: Contact[]): string[][] {
  const header = ['Name', 'Title', 'Org', 'Level', 'Email', 'Phone', 'ReportsTo']
  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })

  const rows: string[][] = [header]
  for (const c of contacts) {
    rows.push([
      c.name,
      c.title ?? '',
      c.org ?? '',
      c.level ?? '',
      c.email ?? '',
      c.phone ?? '',
      c.parentId ? (idToName[c.parentId] ?? '') : '',
    ])
  }
  return rows
}

// ─── Contact exports ──────────────────────────────────────────────────────────

export function exportContactsCSV(contacts: Contact[]): void {
  const rows = buildContactRows(contacts)
  downloadCSV(rows, 'contacts.csv')
}

export function exportContactsXLSX(contacts: Contact[]): void {
  const rows = buildContactRows(contacts)
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts')
  XLSX.writeFile(wb, 'contacts.xlsx')
}

export function exportContactsPDF(contacts: Contact[]): void {
  const rows = buildContactRows(contacts)
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text('Contacts', 14, 16)
  autoTable(doc, {
    head: [rows[0]],
    body: rows.slice(1),
    startY: 22,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
  })
  doc.save('contacts.pdf')
}

export function exportContactsPPTX(contacts: Contact[]): void {
  const pptx = new PptxGenJS()
  const slide = pptx.addSlide()
  slide.addText('Org Chart', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true })

  const sorted = [...contacts].sort((a, b) => {
    const lo = { 'c-level': 0, gm: 1, 'head-of': 2, director: 3, manager: 4, lead: 5, individual: 6 }
    const la = lo[a.level ?? 'individual'] ?? 99
    const lb = lo[b.level ?? 'individual'] ?? 99
    return la - lb || a.name.localeCompare(b.name)
  })

  const idToName: Record<string, string> = {}
  contacts.forEach(c => { idToName[c.id] = c.name })

  const header: PptxGenJS.TableRow = [
    { text: 'Name', options: { bold: true } },
    { text: 'Title', options: { bold: true } },
    { text: 'Org', options: { bold: true } },
    { text: 'Level', options: { bold: true } },
    { text: 'Email', options: { bold: true } },
    { text: 'Phone', options: { bold: true } },
    { text: 'ReportsTo', options: { bold: true } },
  ]

  const body: PptxGenJS.TableRow[] = sorted.map(c => [
    { text: c.name },
    { text: c.title ?? '' },
    { text: c.org ?? '' },
    { text: c.level ?? '' },
    { text: c.email ?? '' },
    { text: c.phone ?? '' },
    { text: c.parentId ? (idToName[c.parentId] ?? '') : '' },
  ])

  slide.addTable([header, ...body], {
    x: 0.5, y: 1.0, w: 9,
    fontSize: 9,
    colW: [1.5, 1.5, 1.2, 1.0, 1.5, 1.0, 1.3],
    border: { pt: 0.5, color: '#e2e8f0' },
    autoPage: true,
  })

  pptx.writeFile({ fileName: 'contacts.pptx' })
}

// ─── Task helpers ─────────────────────────────────────────────────────────────

function buildTaskRows(taskBuckets: TaskBucket[]): string[][] {
  const header = ['Bucket', 'Task', 'Priority', 'Start', 'Due', 'Progress%', 'Done', 'Notes', 'Subtask']
  const rows: string[][] = [header]

  for (const bucket of taskBuckets) {
    for (const task of bucket.tasks) {
      rows.push([
        bucket.name,
        task.text,
        task.priority ?? '',
        task.startDate ?? '',
        task.due ?? '',
        String(task.progress ?? 0),
        '',
        task.notes ?? '',
        '',
      ])
      for (const sub of task.subTasks ?? []) {
        rows.push([
          bucket.name,
          task.text,
          '',
          '',
          sub.due ?? '',
          String(sub.progress ?? 0),
          sub.done ? 'yes' : '',
          sub.notes ?? '',
          sub.text,
        ])
      }
    }
  }

  return rows
}

// ─── Task exports ─────────────────────────────────────────────────────────────

export function exportTasksCSV(taskBuckets: TaskBucket[]): void {
  const rows = buildTaskRows(taskBuckets)
  downloadCSV(rows, 'tasks.csv')
}

export function exportTasksXLSX(taskBuckets: TaskBucket[]): void {
  const rows = buildTaskRows(taskBuckets)
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Tasks')
  XLSX.writeFile(wb, 'tasks.xlsx')
}

export function exportTasksPDF(taskBuckets: TaskBucket[]): void {
  const rows = buildTaskRows(taskBuckets)
  const doc = new jsPDF({ orientation: 'landscape' })
  doc.setFontSize(14)
  doc.text('Tasks', 14, 16)
  autoTable(doc, {
    head: [rows[0]],
    body: rows.slice(1),
    startY: 22,
    styles: { fontSize: 8 },
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

    const header: PptxGenJS.TableRow = [
      { text: 'Task', options: { bold: true } },
      { text: 'Priority', options: { bold: true } },
      { text: 'Start', options: { bold: true } },
      { text: 'Due', options: { bold: true } },
      { text: 'Progress%', options: { bold: true } },
      { text: 'Done', options: { bold: true } },
      { text: 'Notes', options: { bold: true } },
    ]

    const body: PptxGenJS.TableRow[] = []
    for (const task of bucket.tasks) {
      body.push([
        { text: task.text },
        { text: task.priority ?? '' },
        { text: task.startDate ?? '' },
        { text: task.due ?? '' },
        { text: String(task.progress ?? 0) },
        { text: '' },
        { text: task.notes ?? '' },
      ])
      for (const sub of task.subTasks ?? []) {
        body.push([
          { text: `  \u2514 ${sub.text}` },
          { text: '' },
          { text: '' },
          { text: sub.due ?? '' },
          { text: String(sub.progress ?? 0) },
          { text: sub.done ? 'yes' : '' },
          { text: sub.notes ?? '' },
        ])
      }
    }

    slide.addTable([header, ...body], {
      x: 0.5, y: 1.0, w: 9,
      fontSize: 10,
      colW: [2.5, 0.9, 1.0, 1.0, 1.0, 0.7, 1.9],
      border: { pt: 0.5, color: '#e2e8f0' },
      autoPage: true,
    })
  }

  pptx.writeFile({ fileName: 'tasks.pptx' })
}
