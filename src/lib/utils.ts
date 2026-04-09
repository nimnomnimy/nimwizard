import type { Level } from '../types'

export const LEVEL_LABELS: Record<Level, string> = {
  'c-level': 'C-Level',
  'gm': 'Gen. Manager',
  'head-of': 'Head of',
  'director': 'Director',
  'manager': 'Manager',
  'lead': 'Lead',
  'individual': 'IC',
}

export const LEVEL_ORDER: Record<Level, number> = {
  'c-level': 0, 'gm': 1, 'head-of': 2, 'director': 3,
  'manager': 4, 'lead': 5, 'individual': 6,
}

const COLORS = [
  '#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444',
  '#06b6d4','#84cc16','#f97316','#ec4899','#6366f1',
]

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return COLORS[Math.abs(h) % COLORS.length]
}

export function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function downloadCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[][] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const row: string[] = []
    let inQ = false, cell = ''
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++ }
        else if (ch === '"') { inQ = false }
        else { cell += ch }
      } else {
        if (ch === '"') { inQ = true }
        else if (ch === ',') { row.push(cell); cell = '' }
        else { cell += ch }
      }
    }
    row.push(cell)
    result.push(row)
  }
  return result
}
