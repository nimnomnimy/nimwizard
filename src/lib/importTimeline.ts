import type { TimelineItem, TimelineMilestone, SwimLane } from '../types'
import { uid, parseCSV } from './utils'
import ExcelJS from 'exceljs'

const DEFAULT_COLOR = '#6366f1'

function findLane(laneName: string, swimLanes: SwimLane[]): SwimLane {
  const lower = laneName.toLowerCase().trim()
  return swimLanes.find(l => l.label.toLowerCase() === lower) ?? swimLanes[0]
}

function parseRows(
  rows: string[][],
  swimLanes: SwimLane[],
): { items: TimelineItem[]; milestones: TimelineMilestone[] } {
  const items: TimelineItem[] = []
  const milestones: TimelineMilestone[] = []
  if (rows.length < 2) return { items, milestones }

  let currentItem: TimelineItem | null = null

  for (const row of rows.slice(1)) {
    if (row.length < 4) continue
    const type     = row[0]?.trim().toLowerCase() ?? ''
    const laneName = row[1]?.trim() ?? ''
    const name     = row[2]?.trim() ?? ''
    const start    = row[3]?.trim() ?? ''
    const end      = row[4]?.trim() ?? start
    const progress = Math.max(0, Math.min(100, Number(row[5]?.trim() || '0') || 0))
    const notes    = row[6]?.trim() ?? ''

    if (type === 'milestone') {
      milestones.push({ id: uid(), label: name, date: start, color: '#ef4444' })
      currentItem = null
    } else if (type === 'task') {
      const lane = findLane(laneName, swimLanes)
      currentItem = {
        id: uid(), swimLaneId: lane.id, label: name,
        type: 'bar', startDate: start, endDate: end || start,
        color: DEFAULT_COLOR, progress,
        notes: notes || undefined, subItems: [],
      }
      items.push(currentItem)
    } else if (type === 'subtask' && currentItem) {
      const label = name.replace(/^\s*└\s*/, '').trim()
      currentItem.subItems = currentItem.subItems ?? []
      currentItem.subItems.push({
        id: uid(), label, startDate: start, endDate: end || start, progress,
      })
    }
  }

  return { items, milestones }
}

export function importTimelineFromCSV(
  text: string,
  swimLanes: SwimLane[],
): { items: TimelineItem[]; milestones: TimelineMilestone[] } {
  if (!swimLanes.length) return { items: [], milestones: [] }
  return parseRows(parseCSV(text), swimLanes)
}

export async function importTimelineFromXLSX(
  buffer: ArrayBuffer,
  swimLanes: SwimLane[],
): Promise<{ items: TimelineItem[]; milestones: TimelineMilestone[] }> {
  if (!swimLanes.length) return { items: [], milestones: [] }
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return { items: [], milestones: [] }

  const rows: string[][] = []
  ws.eachRow(row => {
    const vals = row.values as (ExcelJS.CellValue | undefined)[]
    rows.push(vals.slice(1).map(v => (v == null ? '' : String(v))))
  })
  return parseRows(rows, swimLanes)
}
