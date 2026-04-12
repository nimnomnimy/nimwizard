import type { TimelineItem } from '../../../types'
import { parseDate, formatDate, addDays, diffDays } from './dateLayout'

// ─── Auto-scheduling ──────────────────────────────────────────────────────────
/**
 * When an item moves, cascade all downstream dependents forward/backward so
 * finish-to-start constraints are preserved.
 *
 * Algorithm: topological BFS from the moved item.
 * We only push items that would now overlap or start before their predecessor ends.
 * We never pull items backward (we don't remove slack automatically).
 */
export function cascadeFromItem(
  items: TimelineItem[],
  movedId: string,
): TimelineItem[] {
  // Build successor map: for each item id, which items depend on it
  const successors = new Map<string, string[]>()
  for (const item of items) {
    for (const predId of item.predecessorIds ?? []) {
      if (!successors.has(predId)) successors.set(predId, [])
      successors.get(predId)!.push(item.id)
    }
  }

  // BFS queue starting from movedId's successors
  const queue = [...(successors.get(movedId) ?? [])]
  const visited = new Set<string>()
  // Work on a mutable copy
  const result = items.map(i => ({ ...i }))
  const byId = new Map(result.map(i => [i.id, i]))

  while (queue.length) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const item = byId.get(id)
    if (!item) continue

    // Find the latest end date among all predecessors
    let latestPredEnd: Date | null = null
    for (const predId of item.predecessorIds ?? []) {
      const pred = byId.get(predId)
      if (!pred) continue
      const predEnd = parseDate(pred.endDate)
      if (!latestPredEnd || predEnd > latestPredEnd) latestPredEnd = predEnd
    }

    if (!latestPredEnd) continue

    const itemStart = parseDate(item.startDate)
    const requiredStart = addDays(latestPredEnd, 1) // day after pred ends

    if (requiredStart > itemStart) {
      // Shift forward, preserving duration
      const duration = Math.max(1, diffDays(parseDate(item.startDate), parseDate(item.endDate)))
      item.startDate = formatDate(requiredStart)
      item.endDate   = formatDate(addDays(requiredStart, duration))
      // Enqueue this item's successors
      for (const sid of successors.get(id) ?? []) {
        if (!visited.has(sid)) queue.push(sid)
      }
    }
  }

  return result
}

// ─── Critical path ────────────────────────────────────────────────────────────
/**
 * Returns the set of item IDs on the critical path — the longest chain from
 * project start to project end measured in calendar days.
 *
 * Uses forward/backward pass (CPM):
 *  - ES (early start) = max end date of all predecessors + 1
 *  - EF (early finish) = ES + duration - 1
 *  - Project end = max EF
 *  - LS (late start) = LF - duration + 1
 *  - LF (late finish) = min LS of all successors - 1
 *  - Float = LS - ES  (zero float = on critical path)
 */
export function computeCriticalPath(items: TimelineItem[]): Set<string> {
  if (items.length === 0) return new Set()

  const barItems = items.filter(i => i.type === 'bar')
  if (barItems.length === 0) return new Set()

  // Build successor map
  const successors = new Map<string, string[]>()
  for (const item of barItems) {
    if (!successors.has(item.id)) successors.set(item.id, [])
    for (const predId of item.predecessorIds ?? []) {
      if (!successors.has(predId)) successors.set(predId, [])
      successors.get(predId)!.push(item.id)
    }
  }

  // Duration in days (inclusive: endDate - startDate)
  function duration(item: TimelineItem): number {
    return Math.max(1, diffDays(parseDate(item.startDate), parseDate(item.endDate)))
  }

  // Forward pass — ES in days from epoch
  const ES = new Map<string, number>()
  const EF = new Map<string, number>()
  const epoch = new Date(0)

  // Topological sort (Kahn's)
  const inDegree = new Map<string, number>()
  for (const item of barItems) inDegree.set(item.id, 0)
  for (const item of barItems) {
    for (const predId of item.predecessorIds ?? []) {
      if (inDegree.has(predId)) inDegree.set(item.id, (inDegree.get(item.id) ?? 0) + 1)
    }
  }

  const topo: string[] = []
  const ready = barItems.filter(i => (inDegree.get(i.id) ?? 0) === 0).map(i => i.id)
  const queue = [...ready]
  while (queue.length) {
    const id = queue.shift()!
    topo.push(id)
    for (const sid of successors.get(id) ?? []) {
      const deg = (inDegree.get(sid) ?? 1) - 1
      inDegree.set(sid, deg)
      if (deg === 0) queue.push(sid)
    }
  }

  const byId = new Map(barItems.map(i => [i.id, i]))

  // Forward pass
  for (const id of topo) {
    const item = byId.get(id)!
    const dur = duration(item)
    let es = diffDays(epoch, parseDate(item.startDate))
    for (const predId of item.predecessorIds ?? []) {
      const predEF = EF.get(predId)
      if (predEF !== undefined) es = Math.max(es, predEF + 1)
    }
    ES.set(id, es)
    EF.set(id, es + dur - 1)
  }

  const projectEnd = Math.max(...[...EF.values()])

  // Backward pass
  const LS = new Map<string, number>()
  const LF = new Map<string, number>()

  for (const id of [...topo].reverse()) {
    const item = byId.get(id)!
    const dur = duration(item)
    const succs = successors.get(id) ?? []
    const lf = succs.length === 0
      ? projectEnd
      : Math.min(...succs.map(sid => (LS.get(sid) ?? projectEnd + 1) - 1))
    LF.set(id, lf)
    LS.set(id, lf - dur + 1)
  }

  // Critical = zero float
  const critical = new Set<string>()
  for (const item of barItems) {
    const es = ES.get(item.id) ?? 0
    const ls = LS.get(item.id) ?? 0
    if (ls - es === 0) critical.add(item.id)
  }

  // Only return critical path if there are actual dependencies (otherwise everything is "critical")
  const hasDeps = barItems.some(i => (i.predecessorIds?.length ?? 0) > 0)
  if (!hasDeps) return new Set()

  return critical
}
