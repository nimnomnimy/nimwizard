import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { avatarColor, initials, uid, LEVEL_LABELS, downloadJSON, pickFile, readFileText } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import ContactDrawer from '../components/contacts/ContactDrawer'
import ExportMenu from '../components/ui/ExportMenu'
import { exportContactsCSV, exportContactsXLSX, exportContactsPDF, exportContactsPPTX } from '../lib/exportUtils'
import type { Contact, Position, Level } from '../types'

// ─── Constants ───────────────────────────────────────────────────────────────
const NODE_W  = 200
const NODE_H  = 88
const SNAP    = 20
const MIN_STUB = 18  // minimum px of horizontal/vertical stub from bus to child

// ─── Branch styles ───────────────────────────────────────────────────────────
type BranchStyle = 'tree' | 'staggered' | 'right-column' | 'left-column' | 'two-column'

// ─── Shape formats ────────────────────────────────────────────────────────────
type ShapeFormat = 'rect' | 'rounded' | 'wide-rounded' | 'card-accent'

// ─── Color themes ─────────────────────────────────────────────────────────────
// 5 accent colors indexed by hierarchy depth 0–4
// These color the accent bar, avatar bg, and node border — cards stay white.
const PRESET_THEMES: { name: string; colors: string[] }[] = [
  { name: 'Default',   colors: ['#6366f1','#3b82f6','#06b6d4','#10b981','#f59e0b'] },
  { name: 'Agile',     colors: ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6'] },
  { name: 'Formula',   colors: ['#1e40af','#7c3aed','#be185d','#047857','#b45309'] },
  { name: 'Modulus',   colors: ['#334155','#475569','#64748b','#94a3b8','#cbd5e1'] },
  { name: 'Pastel',    colors: ['#818cf8','#67e8f9','#86efac','#fde68a','#fca5a5'] },
  { name: 'Ocean',     colors: ['#0ea5e9','#2dd4bf','#a3e635','#fb923c','#e879f9'] },
]
const DEPTH_LABELS = ['Level 1 (C-suite)', 'Level 2 (GM)', 'Level 3 (Director)', 'Level 4 (Manager)', 'Level 5 (Individual)']

// ─── Level → depth map ───────────────────────────────────────────────────────
const LEVEL_DEPTH: Record<string, number> = {
  'c-level': 0, 'gm': 1, 'head-of': 2, 'director': 2,
  'manager': 3, 'lead': 3, 'individual': 4,
}

// ─── Tree layout ─────────────────────────────────────────────────────────────
function buildTreeMap(contacts: Contact[]) {
  const map: Record<string, Contact & { children: (Contact & { children: any[] })[] }> = {}
  contacts.forEach(c => { map[c.id] = { ...c, children: [] } })
  contacts.forEach(c => { if (c.parentId && map[c.parentId]) map[c.parentId].children.push(map[c.id]) })
  const roots = contacts.filter(c => !c.parentId || !map[c.parentId]).map(c => map[c.id])
  return { map, roots }
}

// nodeBranchStyles: per-node override of branch style (key = parent node id)
function computeTreeLayout(
  contacts: Contact[],
  hGap: number,
  vGap: number,
  defaultBranchStyle: BranchStyle,
  nodeBranchStyles: Record<string, BranchStyle>,
): Record<string, Position> {
  if (!contacts.length) return {}
  const { roots } = buildTreeMap(contacts)

  function nodeStyle(node: any): BranchStyle {
    return nodeBranchStyles[node.id] ?? defaultBranchStyle
  }

  // Measure how wide a subtree rooted at node will be, given its branch style
  function subtreeWidth(node: any): number {
    if (!node.children.length) return NODE_W
    const style = nodeStyle(node)
    if (style === 'right-column' || style === 'left-column') {
      // parent column + gap + children column; recurse for child widths
      const childMaxW = Math.max(...node.children.map((c: any) => subtreeWidth(c)))
      return NODE_W + hGap + childMaxW
    }
    if (style === 'two-column') {
      const rows = Math.ceil(node.children.length / 2)
      const pairW = NODE_W * 2 + hGap
      const childRows: any[][] = []
      for (let i = 0; i < rows; i++) childRows.push(node.children.slice(i * 2, i * 2 + 2))
      const maxChildRowW = Math.max(...childRows.map(row =>
        row.reduce((s: number, c: any) => s + subtreeWidth(c), 0) + hGap * (row.length - 1)
      ))
      return Math.max(pairW, maxChildRowW)
    }
    // tree / staggered
    const cw = node.children.reduce((s: number, c: any) => s + subtreeWidth(c), 0)
    return Math.max(NODE_W, cw + hGap * (node.children.length - 1))
  }

  // Measure subtree height (used by column styles for sibling spacing)
  function subtreeHeight(node: any): number {
    const style = nodeStyle(node)
    if (!node.children.length) return NODE_H
    if (style === 'right-column' || style === 'left-column') {
      // height = parent height OR total children column height, whichever is taller
      const childrenColH = node.children.reduce((s: number, c: any) => s + subtreeHeight(c) + vGap, -vGap)
      return Math.max(NODE_H, childrenColH)
    }
    if (style === 'two-column') {
      const rows = Math.ceil(node.children.length / 2)
      let totalChildH = 0
      for (let r = 0; r < rows; r++) {
        const pair = node.children.slice(r * 2, r * 2 + 2)
        const rowH = Math.max(...pair.map((c: any) => subtreeHeight(c)))
        totalChildH += rowH + (r < rows - 1 ? vGap : 0)
      }
      return NODE_H + vGap + totalChildH
    }
    // tree / staggered — height is parent + gap + tallest child subtree
    const maxChildH = Math.max(...node.children.map((c: any) => subtreeHeight(c)))
    return NODE_H + vGap + maxChildH
  }

  const positions: Record<string, Position> = {}

  function layout(node: any, centerX: number, y: number) {
    positions[node.id] = { x: Math.round(centerX - NODE_W / 2), y }
    if (!node.children.length) return

    const style = nodeStyle(node)
    const childY = y + NODE_H + vGap

    if (style === 'right-column') {
      // Parent on left, children stacked vertically in a column to the right
      const colX = centerX + NODE_W / 2 + hGap + NODE_W / 2
      let cy = y
      node.children.forEach((child: any) => {
        layout(child, colX, cy)
        cy += subtreeHeight(child) + vGap
      })
    } else if (style === 'left-column') {
      // Parent on right, children stacked vertically in a column to the left
      const colX = centerX - NODE_W / 2 - hGap - NODE_W / 2
      let cy = y
      node.children.forEach((child: any) => {
        layout(child, colX, cy)
        cy += subtreeHeight(child) + vGap
      })
    } else if (style === 'two-column') {
      // Two columns of children below parent, children pair up left-right
      const totalW = NODE_W * 2 + hGap
      const startX = centerX - totalW / 2 + NODE_W / 2
      const rows = Math.ceil(node.children.length / 2)
      let rowY = childY
      for (let r = 0; r < rows; r++) {
        const pair = node.children.slice(r * 2, r * 2 + 2)
        pair.forEach((child: any, col: number) => {
          const cx = startX + col * (NODE_W + hGap)
          layout(child, cx, rowY)
        })
        const rowH = Math.max(...pair.map((c: any) => subtreeHeight(c)))
        rowY += rowH + vGap
      }
    } else if (style === 'staggered') {
      // Only stagger if ALL children are leaves; otherwise fall back to tree to avoid
      // siblings appearing at the same Y as another sibling's children.
      const anyHasChildren = node.children.some((c: any) => c.children.length > 0)
      const totalW = node.children.reduce((s: number, c: any) => s + subtreeWidth(c), 0) + hGap * (node.children.length - 1)
      let cx = centerX - totalW / 2
      node.children.forEach((child: any, i: number) => {
        const sw = subtreeWidth(child)
        const staggerY = anyHasChildren ? childY : childY + (i % 2) * Math.round(NODE_H * 0.4 + vGap * 0.3)
        layout(child, cx + sw / 2, staggerY)
        cx += sw + hGap
      })
    } else {
      // tree (default)
      const totalW = node.children.reduce((s: number, c: any) => s + subtreeWidth(c), 0) + hGap * (node.children.length - 1)
      let cx = centerX - totalW / 2
      node.children.forEach((child: any) => {
        const sw = subtreeWidth(child)
        layout(child, cx + sw / 2, childY)
        cx += sw + hGap
      })
    }
  }

  // Place roots side by side
  let startX = 30
  roots.forEach(r => {
    const sw = subtreeWidth(r)
    layout(r, startX + sw / 2, 30)
    startX += sw + hGap * 2
  })
  return positions
}

function snap(v: number) { return Math.round(v / SNAP) * SNAP }

// ─── Connection modes ─────────────────────────────────────────────────────────
type ConnDir = 'top' | 'bottom' | 'right' | 'left'
interface ConnMode { sourceId: string; dir: ConnDir; sourceName: string }

// ─── Node depth calculator ────────────────────────────────────────────────────
function getNodeDepth(id: string, contacts: Contact[]): number {
  const c = contacts.find(x => x.id === id)
  if (!c) return 0
  if (c.level && LEVEL_DEPTH[c.level] !== undefined) return LEVEL_DEPTH[c.level]
  // Fallback: count ancestors
  let depth = 0, cur = c
  while (cur.parentId) {
    const parent = contacts.find(x => x.id === cur.parentId)
    if (!parent) break
    cur = parent; depth++
  }
  return depth
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function OrgChartPage() {
  const contacts       = useAppStore(s => s.contacts)
  const chartContacts  = useAppStore(s => s.chartContacts)
  const positions      = useAppStore(s => s.positions)
  const dottedLines    = useAppStore(s => s.dottedLines)
  const peerLines      = useAppStore(s => s.peerLines)
  const activeChartOrg = useAppStore(s => s.activeChartOrg)
  const savedCharts    = useAppStore(s => s.savedCharts)
  const setChartContacts  = useAppStore(s => s.setChartContacts)
  const setPositions      = useAppStore(s => s.setPositions)
  const setActiveChartOrg = useAppStore(s => s.setActiveChartOrg)
  const addDottedLine     = useAppStore(s => s.addDottedLine)
  const removeDottedLine  = useAppStore(s => s.removeDottedLine)
  const addPeerLine       = useAppStore(s => s.addPeerLine)
  const removePeerLine    = useAppStore(s => s.removePeerLine)
  const saveChart         = useAppStore(s => s.saveChart)
  const deleteChart       = useAppStore(s => s.deleteChart)
  const updateContact     = useAppStore(s => s.updateContact)

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'contacts' | 'style'>('contacts')
  const [panelSearch, setPanelSearch] = useState('')
  const [panelOrg, setPanelOrg] = useState('')
  const [drawerContactId, setDrawerContactId] = useState<string | null | undefined>(undefined)
  const [showSavedMenu, setShowSavedMenu] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isDraggingNode, setIsDraggingNode] = useState(false)
  const [zoom, setZoom] = useState(1)

  // Style settings
  const [branchStyle, setBranchStyle] = useState<BranchStyle>('tree')
  const [nodeBranchStyles, setNodeBranchStyles] = useState<Record<string, BranchStyle>>({})
  const [shapeFormat, setShapeFormat] = useState<ShapeFormat>('rounded')
  const [hGap, setHGap] = useState(54)
  const [vGap, setVGap] = useState(60)
  const [lineColor, setLineColor] = useState('#94a3b8')
  const [lineWidth, setLineWidth] = useState(1.5)
  const [useThemeColors, setUseThemeColors] = useState(false)
  const [accentColors, setAccentColors] = useState<string[]>(PRESET_THEMES[0].colors)
  const [editingColorDepth, setEditingColorDepth] = useState<number | null>(null)

  // Connection mode
  const [connMode, setConnMode] = useState<ConnMode | null>(null)

  // Per-connection midpoint offsets (peer/dotted lines only)
  const lineOffsetsRef = useRef<Record<string, number>>({})
  // Per-parent bus offsets — user can drag to shift the horizontal/vertical bus arm
  const [busOffsets, setBusOffsets] = useState<Record<string, number>>({})
  const busOffsetsRef = useRef<Record<string, number>>({})
  useEffect(() => { busOffsetsRef.current = busOffsets }, [busOffsets])

  // Drag refs
  const areaRef   = useRef<HTMLDivElement>(null)
  const treeRef   = useRef<HTMLDivElement>(null)
  const svgRef    = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const nodeDrag      = useRef<{ id: string; origX: number; origY: number; startCX: number; startCY: number; moved: boolean } | null>(null)
  const busHandleDrag = useRef<{ parentId: string; axis: 'x' | 'y'; startCoord: number; startOffset: number } | null>(null)
  const connModeRef   = useRef<ConnMode | null>(null)

  useEffect(() => { connModeRef.current = connMode }, [connMode])

  // Visible contacts
  const chartContactObjs = contacts.filter(c => chartContacts.includes(c.id))
  const visibleContacts  = activeChartOrg
    ? chartContactObjs.filter(c => c.org === activeChartOrg)
    : chartContactObjs

  const uniqueOrgs = [...new Set(contacts.map(c => c.org).filter(Boolean) as string[])].sort()

  // Accent color from theme (colors the border, avatar bg, and accent bar — card stays white)
  function nodeAccentColor(contactId: string): string {
    if (!useThemeColors) return ''
    const depth = getNodeDepth(contactId, contacts)
    return accentColors[Math.min(depth, accentColors.length - 1)]
  }

  // Node border/shape classes
  function nodeShapeClass(): string {
    if (shapeFormat === 'rect') return 'rounded-none'
    if (shapeFormat === 'wide-rounded') return 'rounded-2xl'
    if (shapeFormat === 'card-accent') return 'rounded-xl'
    return 'rounded-xl'  // 'rounded'
  }

  // ─── Draw dot grid ──────────────────────────────────────────────────────────
  const drawGrid = useCallback((w: number, h: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(148,163,184,0.3)'
    for (let x = SNAP; x < w; x += SNAP)
      for (let y = SNAP; y < h; y += SNAP) {
        ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill()
      }
  }, [])

  // ─── Draw SVG connections ───────────────────────────────────────────────────
  const drawConnections = useCallback(() => {
    const svg  = svgRef.current
    const tree = treeRef.current
    if (!svg || !tree) return

    const w = (tree as HTMLElement).scrollWidth, h = (tree as HTMLElement).scrollHeight
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.innerHTML = ''

    const visibleIds = new Set(visibleContacts.map(c => c.id))
    const LW        = String(lineWidth)
    const DASH_COLOR = '#8b5cf6'
    const PEER_COLOR = '#f59e0b'

    function getRect(id: string) {
      const el = (tree as HTMLElement).querySelector<HTMLElement>(`[data-node-id="${id}"]`)
      if (!el) return null
      return {
        x: parseInt(el.style.left) || 0,
        y: parseInt(el.style.top)  || 0,
        w: el.offsetWidth  || NODE_W,
        h: el.offsetHeight || NODE_H,
      }
    }

    function makePath(d: string, stroke: string, dash?: string, w?: string) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      p.setAttribute('d', d)
      p.setAttribute('stroke', stroke)
      p.setAttribute('stroke-width', w ?? LW)
      p.setAttribute('fill', 'none')
      p.setAttribute('stroke-linecap', 'square')
      p.setAttribute('stroke-linejoin', 'miter')
      p.setAttribute('pointer-events', 'none')
      if (dash) p.setAttribute('stroke-dasharray', dash)
      return p
    }

    function makeHitPath(d: string, stroke: string, onDelete: () => void, visPaths: SVGPathElement[]) {
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hit.setAttribute('d', d)
      hit.setAttribute('stroke', 'transparent')
      hit.setAttribute('stroke-width', '20')
      hit.setAttribute('fill', 'none')
      hit.setAttribute('pointer-events', 'stroke')
      hit.style.cursor = 'pointer'
      let downX = 0, downY = 0
      hit.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; visPaths.forEach(p => { p.setAttribute('stroke', '#ef4444'); p.setAttribute('stroke-width', '2.5') }) })
      hit.addEventListener('pointerup',   e => { const moved = Math.abs(e.clientX-downX)>8||Math.abs(e.clientY-downY)>8; if (!moved) { e.stopPropagation(); if (confirm('Remove this connection?')) onDelete() } visPaths.forEach(p => { p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', LW) }) })
      hit.addEventListener('pointercancel', () => visPaths.forEach(p => { p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', LW) }))
      return hit
    }

    // ── Peer / dotted lines: simple elbow ────────────────────────────────────
    function drawElbow(fromId: string, toId: string, stroke: string, dash: string, onDelete: () => void) {
      const a = getRect(fromId), b = getRect(toId)
      if (!a || !b) return
      const connKey = `${fromId}:${toId}`
      const offset = lineOffsetsRef.current[connKey] ?? 0
      const isPeer = a.x !== b.x  // horizontal layout
      let d: string
      if (isPeer) {
        const left = a.x < b.x ? a : b, right = a.x < b.x ? b : a
        const y1 = left.y + left.h/2, y2 = right.y + right.h/2
        const x1 = left.x + left.w, x2 = right.x
        const midX = (x1 + x2) / 2 + offset
        d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
      } else {
        const top = a.y < b.y ? a : b, bot = a.y < b.y ? b : a
        const x1 = top.x + top.w/2, y1 = top.y + top.h
        const x2 = bot.x + bot.w/2, y2 = bot.y
        const midY = (y1 + y2) / 2 + offset
        d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
      }
      const vis = makePath(d, stroke, dash)
      ;(svg as SVGSVGElement).appendChild(vis)
      ;(svg as SVGSVGElement).appendChild(makeHitPath(d, stroke, onDelete, [vis]))
    }

    // ── Trunk+bus connectors for hierarchy lines ──────────────────────────────
    // Group children by parent, draw one set of trunk lines per parent
    const childrenByParent: Record<string, string[]> = {}
    contacts.forEach(c => {
      if (c.parentId && visibleIds.has(c.id) && visibleIds.has(c.parentId)) {
        if (!childrenByParent[c.parentId]) childrenByParent[c.parentId] = []
        childrenByParent[c.parentId].push(c.id)
      }
    })

    Object.entries(childrenByParent).forEach(([parentId, childIds]) => {
      const par = getRect(parentId)
      if (!par) return

      const effectiveStyle = nodeBranchStyles[parentId] ?? branchStyle

      // Separate assistant children (title contains 'asst' or 'assistant') from regular
      const isAssistant = (id: string) => {
        const c = contacts.find(x => x.id === id)
        return /^asst\.?$|assistant/i.test(c?.title ?? '') || /^asst\.?$|assistant/i.test(c?.name ?? '')
      }
      const assistantIds = childIds.filter(isAssistant)
      const regularIds   = childIds.filter(id => !isAssistant(id))

      const deleteConn = (childId: string) => {
        const c = contacts.find(x => x.id === childId)
        if (c) updateContact({ ...c, parentId: undefined })
      }

      // ── Column styles: exit parent side-center → fixed bus X in the h-gap → stubs to child side-centers ──
      if (effectiveStyle === 'right-column' || effectiveStyle === 'left-column') {
        const isRight  = effectiveStyle === 'right-column'
        const parExitX = isRight ? par.x + par.w : par.x
        const parMidY  = par.y + par.h / 2

        const childRects = regularIds.map(id => ({ id, r: getRect(id) })).filter(x => x.r) as { id: string; r: NonNullable<ReturnType<typeof getRect>> }[]

        if (childRects.length > 0) {
          // Bus X sits at midpoint of the horizontal gap (hGap/2 from parent edge), user-adjustable
          const busOffset = busOffsetsRef.current[parentId] ?? 0
          const baseBusX  = isRight ? parExitX + hGap / 2 : parExitX - hGap / 2
          const busX      = baseBusX + busOffset

          // Horizontal trunk: parent exit → bus X
          ;(svg as SVGSVGElement).appendChild(makePath(`M ${parExitX} ${parMidY} L ${busX} ${parMidY}`, lineColor))

          // Vertical bus: spans all child mid-Y values
          const childMidYs = childRects.map(x => x.r.y + x.r.h / 2)
          const busTop    = Math.min(parMidY, ...childMidYs)
          const busBottom = Math.max(parMidY, ...childMidYs)
          if (busTop < busBottom) {
            ;(svg as SVGSVGElement).appendChild(makePath(`M ${busX} ${busTop} L ${busX} ${busBottom}`, lineColor))
          }

          // Stubs: busX → each child near-edge at mid-Y
          childRects.forEach(({ id: childId, r: ch }) => {
            const childMidY  = ch.y + ch.h / 2
            const childEdgeX = isRight ? ch.x : ch.x + ch.w
            const d = `M ${busX} ${childMidY} L ${childEdgeX} ${childMidY}`
            const vis = makePath(d, lineColor)
            ;(svg as SVGSVGElement).appendChild(vis)
            ;(svg as SVGSVGElement).appendChild(makeHitPath(d, lineColor, () => deleteConn(childId), [vis]))
          })
          // (bus handle rendered as React div — see busHandles below)
        }

        // Assistants: horizontal off parent side, then stub down to child top-center
        assistantIds.forEach(childId => {
          const ch = getRect(childId)
          if (!ch) return
          const chCX = ch.x + ch.w / 2
          const d = `M ${parExitX} ${parMidY} L ${chCX} ${parMidY} L ${chCX} ${ch.y}`
          const vis = makePath(d, lineColor)
          ;(svg as SVGSVGElement).appendChild(vis)
          ;(svg as SVGSVGElement).appendChild(makeHitPath(d, lineColor, () => deleteConn(childId), [vis]))
        })
        return
      }

      // ── Two-column: vertical center bus with horizontal stubs left/right to each pair ──
      if (effectiveStyle === 'two-column' && regularIds.length > 0) {
        const parCX    = par.x + par.w / 2
        const trunkTop = par.y + par.h
        const busOffset = busOffsetsRef.current[parentId] ?? 0
        const busY      = trunkTop + vGap / 2 + busOffset

        // Trunk: parent bottom-center → horizontal bus Y
        ;(svg as SVGSVGElement).appendChild(makePath(`M ${parCX} ${trunkTop} L ${parCX} ${busY}`, lineColor))

        const regularRects = regularIds.map(id => ({ id, r: getRect(id) })).filter(x => x.r) as { id: string; r: NonNullable<ReturnType<typeof getRect>> }[]

        // Vertical center bus: from busY down to mid-Y of the last row's cards
        const childMidYs = regularRects.map(x => x.r.y + x.r.h / 2)
        const busBottom  = Math.max(...childMidYs)
        if (busY < busBottom) {
          ;(svg as SVGSVGElement).appendChild(makePath(`M ${parCX} ${busY} L ${parCX} ${busBottom}`, lineColor))
        }

        // Horizontal stubs: center bus → each child side-center
        // Even index (left col) → stub goes right from left-edge; odd (right col) → stub goes left from right-edge
        regularRects.forEach(({ id: childId, r: ch }, i) => {
          const childMidY  = ch.y + ch.h / 2
          const isLeftCol  = i % 2 === 0
          const childEdgeX = isLeftCol ? ch.x + ch.w : ch.x  // right edge of left card, left edge of right card
          const d = `M ${parCX} ${childMidY} L ${childEdgeX} ${childMidY}`
          const vis = makePath(d, lineColor)
          ;(svg as SVGSVGElement).appendChild(vis)
          ;(svg as SVGSVGElement).appendChild(makeHitPath(d, lineColor, () => deleteConn(childId), [vis]))
        })
        // (bus handle rendered as React div — see busHandles below)

        // Assistants tap off the trunk
        assistantIds.forEach(childId => {
          const ch = getRect(childId)
          if (!ch) return
          const tapY = Math.round(trunkTop + (busY - trunkTop) * 0.5)
          const chCX = ch.x + ch.w / 2
          const d = `M ${parCX} ${tapY} L ${chCX} ${tapY} L ${chCX} ${ch.y}`
          const vis = makePath(d, lineColor)
          ;(svg as SVGSVGElement).appendChild(vis)
          ;(svg as SVGSVGElement).appendChild(makeHitPath(d, lineColor, () => deleteConn(childId), [vis]))
        })
        return
      }

      // ── Tree / Staggered: bottom-center trunk → fixed bus Y in the v-gap → stubs to child tops ──
      if (regularIds.length === 0 && assistantIds.length === 0) return

      const parCX    = par.x + par.w / 2
      const trunkTop = par.y + par.h

      const regularRects = regularIds.map(id => getRect(id)).filter(Boolean) as NonNullable<ReturnType<typeof getRect>>[]

      // Bus Y sits at midpoint of the vertical gap — fixed, user-adjustable, independent of child positions
      const busOffset = busOffsetsRef.current[parentId] ?? 0
      const busY      = trunkTop + vGap / 2 + busOffset

      if (regularIds.length > 0) {
        // Trunk: parent bottom-center straight down to bus Y
        ;(svg as SVGSVGElement).appendChild(makePath(`M ${parCX} ${trunkTop} L ${parCX} ${busY}`, lineColor))

        // Bus: spans from leftmost to rightmost child top-center
        const childCXs = regularRects.map(r => r.x + r.w / 2)
        const busLeft  = Math.min(parCX, ...childCXs)
        const busRight = Math.max(parCX, ...childCXs)
        if (busLeft < busRight) {
          ;(svg as SVGSVGElement).appendChild(makePath(`M ${busLeft} ${busY} L ${busRight} ${busY}`, lineColor))
        }

        // Stubs: bus Y → each child top-center (always visible even if child is dragged close)
        regularIds.forEach(childId => {
          const ch = getRect(childId)
          if (!ch) return
          const cx = ch.x + ch.w / 2
          const stubTop = Math.min(busY, ch.y - MIN_STUB)
          const d = `M ${cx} ${stubTop} L ${cx} ${ch.y}`
          const vis = makePath(d, lineColor)
          ;(svg as SVGSVGElement).appendChild(vis)
          ;(svg as SVGSVGElement).appendChild(makeHitPath(d, lineColor, () => deleteConn(childId), [vis]))
        })
        // (bus handle rendered as React div — see busHandles below)
      }

      // Assistants: tap off trunk at the bus Y level
      assistantIds.forEach(childId => {
        const ch = getRect(childId)
        if (!ch) return
        const tapY = Math.round(trunkTop + (busY - trunkTop) * 0.5)
        const chCX = ch.x + ch.w / 2
        const d = `M ${parCX} ${tapY} L ${chCX} ${tapY} L ${chCX} ${ch.y}`
        const vis = makePath(d, lineColor)
        ;(svg as SVGSVGElement).appendChild(vis)
        ;(svg as SVGSVGElement).appendChild(makeHitPath(d, lineColor, () => deleteConn(childId), [vis]))
      })
    })

    // ── Dotted + peer lines ───────────────────────────────────────────────────
    dottedLines.forEach(dl => {
      if (visibleIds.has(dl.fromId) && visibleIds.has(dl.toId))
        drawElbow(dl.fromId, dl.toId, DASH_COLOR, '5,4', () => removeDottedLine(dl.fromId, dl.toId))
    })
    peerLines.forEach(pl => {
      if (visibleIds.has(pl.fromId) && visibleIds.has(pl.toId))
        drawElbow(pl.fromId, pl.toId, PEER_COLOR, '6,3', () => removePeerLine(pl.fromId, pl.toId))
    })
  }, [visibleContacts, contacts, dottedLines, peerLines, lineColor, lineWidth, branchStyle, nodeBranchStyles, hGap, vGap, busOffsets, updateContact, removeDottedLine, removePeerLine])

  // Resize / redraw
  useEffect(() => {
    requestAnimationFrame(() => {
      const tree = treeRef.current
      const area = areaRef.current
      if (!tree || !area) return
      let maxX = area.clientWidth, maxY = area.clientHeight
      tree.querySelectorAll<HTMLElement>('[data-node-id]').forEach(el => {
        maxX = Math.max(maxX, parseInt(el.style.left) + NODE_W + 80)
        maxY = Math.max(maxY, parseInt(el.style.top)  + NODE_H + 80)
      })
      tree.style.width  = maxX + 'px'
      tree.style.height = maxY + 'px'
      drawGrid(maxX, maxY)
      drawConnections()
    })
  }, [visibleContacts, positions, drawGrid, drawConnections])

  // ─── Apply connection ───────────────────────────────────────────────────────
  const applyConn = useCallback((targetId: string) => {
    const cm = connModeRef.current
    if (!cm || cm.sourceId === targetId) { setConnMode(null); return }
    const src = contacts.find(c => c.id === cm.sourceId)
    const tgt = contacts.find(c => c.id === targetId)
    if (!src || !tgt) { setConnMode(null); return }

    if (cm.dir === 'top') {
      updateContact({ ...src, parentId: targetId })
      showToast(`${src.name} → reports to → ${tgt.name}`, 'success')
    } else if (cm.dir === 'bottom') {
      updateContact({ ...tgt, parentId: cm.sourceId })
      showToast(`${tgt.name} → reports to → ${src.name}`, 'success')
    } else if (cm.dir === 'right') {
      const exists = peerLines.some(p =>
        (p.fromId === cm.sourceId && p.toId === targetId) ||
        (p.fromId === targetId && p.toId === cm.sourceId)
      )
      if (!exists) addPeerLine({ fromId: cm.sourceId, toId: targetId })
      showToast(`${src.name} ⟷ peer ⟷ ${tgt.name}`, 'success')
    } else if (cm.dir === 'left') {
      const exists = dottedLines.some(d =>
        (d.fromId === cm.sourceId && d.toId === targetId) ||
        (d.fromId === targetId && d.toId === cm.sourceId)
      )
      if (!exists) addDottedLine({ fromId: cm.sourceId, toId: targetId })
      showToast(`Dotted line: ${src.name} ⋯ ${tgt.name}`, 'success')
    }
    setConnMode(null)
  }, [contacts, peerLines, dottedLines, updateContact, addPeerLine, addDottedLine])

  // ─── Add / remove from chart ────────────────────────────────────────────────
  const addToChart = (c: Contact) => {
    if (chartContacts.includes(c.id)) { showToast(`${c.name} is already on the chart`); return }
    const area = areaRef.current
    const offset = chartContacts.length * 20
    const baseX = snap(((area ? area.scrollLeft + area.clientWidth / 2 : 200) - NODE_W / 2) + offset)
    const baseY = snap(((area ? area.scrollTop + area.clientHeight / 2 : 200) - NODE_H / 2) + offset)
    setPositions({ ...positions, [c.id]: { x: baseX, y: baseY } })
    setChartContacts([...chartContacts, c.id])
    if (activeChartOrg && c.org !== activeChartOrg) setActiveChartOrg(null)
    showToast(`${c.name} added to chart`, 'success')
  }

  const removeFromChart = (id: string) => {
    const c = contacts.find(x => x.id === id)
    const newPos = { ...positions }; delete newPos[id]
    setPositions(newPos)
    setChartContacts(chartContacts.filter(x => x !== id))
    contacts.filter(x => x.parentId === id).forEach(x => updateContact({ ...x, parentId: undefined }))
    showToast(`${c?.name ?? 'Contact'} removed from chart`)
  }

  // ─── Auto-layout ────────────────────────────────────────────────────────────
  const cleanupLayout = () => {
    const fresh = computeTreeLayout(visibleContacts, hGap, vGap, branchStyle, nodeBranchStyles)
    setPositions({ ...positions, ...fresh })
    setBusOffsets({})
    busOffsetsRef.current = {}
    showToast('Layout applied', 'success')
  }

  // ─── Save / export charts ───────────────────────────────────────────────────
  const doSaveChart = () => {
    const name = prompt('Name this chart:', activeChartOrg || 'My Chart')
    if (!name) return
    saveChart({
      id: uid(), name,
      savedAt: new Date().toISOString(),
      contactIds: [...chartContacts],    // store IDs only — live contacts[] is the source of truth
      dottedLines: dottedLines.map(d => ({ ...d })),
      peerLines:   peerLines.map(d => ({ ...d })),
      chartContacts: [...chartContacts],
      positions: { ...positions },
    })
    showToast(`Chart "${name}" saved`, 'success')
    setShowSavedMenu(false)
  }

  const doExportChart = (id: string) => {
    const ch = savedCharts.find(c => c.id === id)
    if (!ch) return
    downloadJSON(ch, `orgchart-${ch.name.replace(/\s+/g, '-').toLowerCase()}.json`)
    showToast(`Chart "${ch.name}" exported`, 'success')
    setShowSavedMenu(false)
  }

  const doExportAllCharts = () => {
    downloadJSON(savedCharts, 'orgcharts.json')
    showToast('All charts exported', 'success')
    setShowSavedMenu(false)
  }

  const doImportChart = async () => {
    const file = await pickFile('.json')
    if (!file) return
    try {
      const data = JSON.parse(await readFileText(file))
      const charts = Array.isArray(data) ? data : [data]
      let added = 0
      for (const ch of charts) {
        if (typeof ch !== 'object' || !ch?.name) continue
        // Migrate legacy format: if contacts[] present, convert to contactIds[]
        const contactIds: string[] = ch.contactIds ?? (ch.contacts ?? []).map((c: Contact) => c.id)
        saveChart({ ...ch, id: uid(), savedAt: new Date().toISOString(), contactIds, contacts: undefined })
        added++
      }
      showToast(`${added} chart${added !== 1 ? 's' : ''} imported`, 'success')
    } catch {
      showToast('Invalid JSON file')
    }
    setShowSavedMenu(false)
  }

  // ─── Node drag handlers ─────────────────────────────────────────────────────
  const onNodePointerDown = (e: React.PointerEvent, c: Contact) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    nodeDrag.current = {
      id: c.id,
      origX: parseInt(el.style.left) || 0,
      origY: parseInt(el.style.top)  || 0,
      startCX: e.clientX,
      startCY: e.clientY,
      moved: false,
    }
    setIsDraggingNode(true)
    e.preventDefault()
  }

  const onNodePointerMove = (e: React.PointerEvent, c: Contact) => {
    const d = nodeDrag.current
    if (!d || d.id !== c.id) return
    const dx = e.clientX - d.startCX
    const dy = e.clientY - d.startCY
    if (!d.moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) d.moved = true
    if (d.moved) {
      let newX = Math.max(0, d.origX + dx)
      let newY = Math.max(0, d.origY + dy)

      // ── Collision clamping: keep MIN_STUB clearance from every other card ──
      const minH = NODE_H + MIN_STUB * 2  // vertical clearance
      visibleContacts.forEach(other => {
        if (other.id === c.id) return
        const op = getPos(other.id)
        const overlapX = newX < op.x + NODE_W + MIN_STUB && newX + NODE_W + MIN_STUB > op.x
        const overlapY = newY < op.y + minH && newY + minH > op.y
        if (overlapX && overlapY) {
          // Push out whichever axis has less penetration
          const pushRight = op.x + NODE_W + MIN_STUB - newX
          const pushLeft  = newX + NODE_W + MIN_STUB - op.x
          const pushDown  = op.y + minH - newY
          const pushUp    = newY + minH - op.y
          const minPush   = Math.min(pushRight, pushLeft, pushDown, pushUp)
          if (minPush === pushRight) newX = op.x + NODE_W + MIN_STUB
          else if (minPush === pushLeft) newX = op.x - NODE_W - MIN_STUB
          else if (minPush === pushDown) newY = op.y + minH
          else newY = op.y - minH
        }
      })

      const el = e.currentTarget as HTMLElement
      el.style.left = newX + 'px'
      el.style.top  = newY + 'px'
      drawConnections()
    }
  }

  const onNodePointerUp = (e: React.PointerEvent, c: Contact) => {
    const d = nodeDrag.current
    if (!d || d.id !== c.id) return
    if (d.moved) {
      const el = e.currentTarget as HTMLElement
      const x = snap(Math.max(0, parseInt(el.style.left) || 0))
      const y = snap(Math.max(0, parseInt(el.style.top)  || 0))
      el.style.left = x + 'px'; el.style.top = y + 'px'
      setPositions({ ...positions, [c.id]: { x, y } })
      setSelectedNodeId(null)
    } else if (e.pointerType === 'touch') {
      setSelectedNodeId(prev => prev === c.id ? null : c.id)
    }
    nodeDrag.current = null
    setIsDraggingNode(false)
  }

  // ─── Panel contacts ─────────────────────────────────────────────────────────
  const panelContacts = contacts
    .filter(c => {
      const q = panelSearch.toLowerCase()
      if (q && !c.name.toLowerCase().includes(q) && !(c.title ?? '').toLowerCase().includes(q)) return false
      if (panelOrg && c.org !== panelOrg) return false
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // ─── Positions: fall back to auto-layout ────────────────────────────────────
  const layoutFallback = computeTreeLayout(visibleContacts, hGap, vGap, branchStyle, nodeBranchStyles)
  const getPos = (id: string): Position => positions[id] || layoutFallback[id] || { x: 20, y: 20 }

  // ─── Bus handles: one per parent that has visible children ──────────────────
  // Each handle is a React div — stable across SVG redraws, so pointer capture never breaks
  const busHandles = useMemo(() => {
    const handles: { parentId: string; x: number; y: number; axis: 'x' | 'y' }[] = []
    const visibleIds = new Set(visibleContacts.map(c => c.id))
    const childrenByParent: Record<string, string[]> = {}
    contacts.forEach(c => {
      if (c.parentId && visibleIds.has(c.id) && visibleIds.has(c.parentId)) {
        if (!childrenByParent[c.parentId]) childrenByParent[c.parentId] = []
        childrenByParent[c.parentId].push(c.id)
      }
    })
    Object.entries(childrenByParent).forEach(([parentId, childIds]) => {
      const par = getPos(parentId)
      const style = nodeBranchStyles[parentId] ?? branchStyle
      const isAssistant = (id: string) => {
        const c = contacts.find(x => x.id === id)
        return /^asst\.?$|assistant/i.test(c?.title ?? '') || /^asst\.?$|assistant/i.test(c?.name ?? '')
      }
      const regularIds = childIds.filter(id => !isAssistant(id))
      if (regularIds.length === 0) return

      const busOffset = busOffsets[parentId] ?? 0

      if (style === 'right-column' || style === 'left-column') {
        const isRight  = style === 'right-column'
        const parExitX = isRight ? par.x + NODE_W : par.x
        const parMidY  = par.y + NODE_H / 2
        const baseBusX = isRight ? parExitX + hGap / 2 : parExitX - hGap / 2
        handles.push({ parentId, x: baseBusX + busOffset, y: parMidY, axis: 'x' })
      } else {
        // tree, staggered, two-column — all use vertical trunk + bus Y handle
        const parCX    = par.x + NODE_W / 2
        const trunkTop = par.y + NODE_H
        handles.push({ parentId, x: parCX, y: trunkTop + vGap / 2 + busOffset, axis: 'y' })
      }
    })
    return handles
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleContacts, contacts, positions, nodeBranchStyles, branchStyle, hGap, vGap, busOffsets])

  // ─── Connection handles ──────────────────────────────────────────────────────
  const CONN_LABELS: Record<ConnDir, (name: string) => string> = {
    top:    n => `${n} will report to…`,
    bottom: n => `…will report to ${n}`,
    right:  n => `Peer of ${n}…`,
    left:   n => `Dotted-line from ${n}…`,
  }
  const CONN_COLORS: Record<ConnDir, string> = {
    top: '#3b82f6', bottom: '#10b981', right: '#f59e0b', left: '#8b5cf6'
  }

  // ─── Branch style options ────────────────────────────────────────────────────
  const BRANCH_STYLES: { value: BranchStyle; label: string; icon: React.ReactNode }[] = [
    { value: 'tree', label: 'Tree', icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="7" y="1" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.8"/>
        <rect x="1" y="13" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="7" y="13" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="13" y="13" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <path d="M9 4v3M9 7H3v3M9 7h6v3" stroke="currentColor" strokeWidth="1"/>
      </svg>
    )},
    { value: 'staggered', label: 'Staggered', icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="7" y="1" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.8"/>
        <rect x="1" y="11" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="13" y="14" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <path d="M9 4v4M9 8L3 10M9 8l5 4" stroke="currentColor" strokeWidth="1"/>
      </svg>
    )},
    { value: 'right-column', label: 'Right Column', icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="7" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.8"/>
        <rect x="12" y="3" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="12" y="7" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="12" y="11" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <path d="M6 8.5h3M9 8.5V4.5h3M9 8.5v3h3M9 8.5v4.5h3" stroke="currentColor" strokeWidth="1"/>
      </svg>
    )},
    { value: 'left-column', label: 'Left Column', icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="12" y="7" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.8"/>
        <rect x="1" y="3" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="1" y="7" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="1" y="11" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <path d="M12 8.5H9M9 8.5V4.5H6M9 8.5v3H6M9 8.5v4.5H6" stroke="currentColor" strokeWidth="1"/>
      </svg>
    )},
    { value: 'two-column', label: 'Two Column', icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="7" y="1" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.8"/>
        <rect x="1" y="11" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="13" y="11" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="1" y="15" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="13" y="15" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.6"/>
        <path d="M9 4v4M9 8H3v3M9 8h6v3M3 14v1M15 14v1" stroke="currentColor" strokeWidth="1"/>
      </svg>
    )},
  ]

  const SHAPE_FORMATS: { value: ShapeFormat; label: string }[] = [
    { value: 'rect',        label: 'Square' },
    { value: 'rounded',     label: 'Rounded' },
    { value: 'wide-rounded', label: 'Pill' },
    { value: 'card-accent', label: 'Accent' },
  ]

  return (
    <div className="h-full flex overflow-hidden bg-slate-100">

      {/* ── Left panel ── */}
      <>
        {panelOpen && (
          <div className="lg:hidden fixed inset-0 bg-black/30 z-20" onClick={() => setPanelOpen(false)} />
        )}

        <div className={`
          fixed lg:static z-30
          flex flex-col bg-white border-r border-slate-200
          transition-transform duration-300
          lg:translate-x-0 lg:w-64 lg:flex-shrink-0 lg:h-full
          inset-x-0 bottom-0 rounded-t-2xl max-h-[90dvh]
          lg:inset-auto lg:rounded-none lg:max-h-full
          ${panelOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
        `}>
          <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>

          {/* Panel tabs */}
          <div className="flex border-b border-slate-100 flex-shrink-0">
            <button onClick={() => setPanelTab('contacts')}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors ${panelTab === 'contacts' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400'}`}>
              Contacts
            </button>
            <button onClick={() => setPanelTab('style')}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-colors ${panelTab === 'style' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-400'}`}>
              Style
            </button>
          </div>

          {/* ── Contacts tab ── */}
          {panelTab === 'contacts' && (
            <>
              <div className="px-3 pt-2 pb-1 border-b border-slate-100 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Contacts</span>
                  <button onClick={() => { setDrawerContactId(null); setPanelOpen(false) }}
                    className="text-xs text-blue-500 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50 min-h-[32px]">
                    + New
                  </button>
                </div>
                <input type="search" value={panelSearch} onChange={e => setPanelSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 mb-1.5" />
                <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                  {['', ...uniqueOrgs].map(org => (
                    <button key={org} onClick={() => setPanelOrg(org)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap border flex-shrink-0 ${panelOrg === org ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-400 border-slate-200'}`}>
                      {org || 'All'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scroll-touch py-1">
                {panelContacts.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No contacts found</p>
                ) : panelContacts.map(c => {
                  const onChart = chartContacts.includes(c.id)
                  return (
                    <button key={c.id} onClick={() => addToChart(c)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 active:bg-blue-100 transition-colors ${onChart ? 'opacity-40 cursor-default' : ''}`}>
                      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                        style={{ background: avatarColor(c.name) }}>
                        {initials(c.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{c.name}</p>
                        {(c.title || c.org) && (
                          <p className="text-[10px] text-slate-400 truncate">{[c.title, c.org].filter(Boolean).join(' · ')}</p>
                        )}
                      </div>
                      {onChart && <span className="text-[10px] text-slate-300 flex-shrink-0">on chart</span>}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Style tab ── */}
          {panelTab === 'style' && (
            <div className="flex-1 overflow-y-auto scroll-touch px-3 py-3 flex flex-col gap-5">

              {/* Branch Style */}
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Branch Style</p>
                <div className="flex flex-col gap-1">
                  {BRANCH_STYLES.map(bs => (
                    <button key={bs.value} onClick={() => { setBranchStyle(bs.value) }}
                      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${branchStyle === bs.value ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'text-slate-600 hover:bg-slate-50'}`}>
                      <span className={branchStyle === bs.value ? 'text-amber-500' : 'text-slate-400'}>{bs.icon}</span>
                      {bs.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shape Format */}
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Shape Format</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {SHAPE_FORMATS.map(sf => (
                    <button key={sf.value} onClick={() => setShapeFormat(sf.value)}
                      className={`py-2 px-2 text-xs font-semibold border-2 transition-colors ${
                        sf.value === 'rect' ? 'rounded-none' :
                        sf.value === 'rounded' ? 'rounded-lg' :
                        sf.value === 'wide-rounded' ? 'rounded-2xl' : 'rounded-lg'
                      } ${shapeFormat === sf.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                      {sf.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Spacing */}
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Spacing</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-slate-500 flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2v8M10 2v8M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Vertical gap
                    </label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setVGap(g => Math.max(10, g - 10))} className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs font-bold">−</button>
                      <span className="w-10 text-center text-sm font-semibold text-slate-700">{vGap}</span>
                      <button onClick={() => setVGap(g => Math.min(200, g + 10))} className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs font-bold">+</button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-slate-500 flex items-center gap-1.5">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2h8M2 10h8M6 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Horizontal gap
                    </label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setHGap(g => Math.max(10, g - 10))} className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs font-bold">−</button>
                      <span className="w-10 text-center text-sm font-semibold text-slate-700">{hGap}</span>
                      <button onClick={() => setHGap(g => Math.min(200, g + 10))} className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs font-bold">+</button>
                    </div>
                  </div>
                </div>
                <button onClick={cleanupLayout}
                  className="mt-2 w-full py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition-colors">
                  Apply layout
                </button>
              </div>

              {/* Line Style */}
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">Connection Lines</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-slate-500">Colour</label>
                    <input type="color" value={lineColor} onChange={e => setLineColor(e.target.value)}
                      className="w-8 h-7 rounded border border-slate-200 cursor-pointer p-0.5" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-slate-500">Thickness</label>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setLineWidth(w => Math.max(0.5, Math.round((w - 0.5) * 2) / 2))} className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs font-bold">−</button>
                      <span className="w-8 text-center text-sm font-semibold text-slate-700">{lineWidth}</span>
                      <button onClick={() => setLineWidth(w => Math.min(6, Math.round((w + 0.5) * 2) / 2))} className="w-6 h-6 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 flex items-center justify-center text-xs font-bold">+</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Color Themes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Accent Colours</p>
                  <button onClick={() => setUseThemeColors(t => !t)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${useThemeColors ? 'bg-blue-500' : 'bg-slate-200'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${useThemeColors ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>

                {/* Preset swatches */}
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {PRESET_THEMES.map(theme => (
                    <button key={theme.name}
                      onClick={() => { setAccentColors(theme.colors); setUseThemeColors(true) }}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors ${
                        useThemeColors && accentColors.join() === theme.colors.join()
                          ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:border-slate-200'
                      }`}>
                      <div className="flex gap-0.5">
                        {theme.colors.slice(0,5).map((col, j) => (
                          <div key={j} className="w-3 h-3 rounded-sm" style={{ background: col }} />
                        ))}
                      </div>
                      <span className="text-[9px] font-semibold text-slate-500">{theme.name}</span>
                    </button>
                  ))}
                </div>

                {/* Custom per-level colour pickers */}
                {useThemeColors && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[10px] text-slate-400 font-medium mb-0.5">Customise by level</p>
                    {DEPTH_LABELS.map((label, depth) => (
                      <div key={depth} className="flex items-center gap-2">
                        <div className="relative">
                          <div className="w-6 h-6 rounded border border-slate-200 cursor-pointer overflow-hidden"
                            style={{ background: accentColors[depth] }}
                            onClick={() => setEditingColorDepth(editingColorDepth === depth ? null : depth)} />
                          {editingColorDepth === depth && (
                            <input
                              type="color"
                              value={accentColors[depth]}
                              onChange={e => {
                                const next = [...accentColors]
                                next[depth] = e.target.value
                                setAccentColors(next)
                              }}
                              onBlur={() => setEditingColorDepth(null)}
                              autoFocus
                              className="absolute top-7 left-0 w-8 h-8 p-0 border-0 cursor-pointer opacity-0 z-10"
                              style={{ width: 32, height: 32 }}
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 truncate flex-1">{label}</span>
                        <input
                          type="color"
                          value={accentColors[depth]}
                          onChange={e => {
                            const next = [...accentColors]
                            next[depth] = e.target.value
                            setAccentColors(next)
                          }}
                          className="w-6 h-6 rounded border border-slate-200 cursor-pointer p-0"
                          title={label}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </>

      {/* ── Main chart area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="bg-white border-b border-slate-200 flex-shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap">
          <button onClick={() => setPanelOpen(p => !p)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium min-h-[40px] active:bg-slate-50">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.4"/>
              <circle cx="5" cy="10" r="2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M9 4h4M9 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Contacts
          </button>

          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide flex-1">
            {[null, ...uniqueOrgs].map(org => (
              <button key={org ?? '__all'} onClick={() => setActiveChartOrg(org)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border flex-shrink-0 transition-colors ${activeChartOrg === org ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                {org ?? 'All'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <ExportMenu
              onCSV={() => { exportContactsCSV(visibleContacts); showToast('Exported as CSV', 'success') }}
              onXLSX={() => { exportContactsXLSX(visibleContacts, { contacts: visibleContacts, positions, dottedLines, peerLines }).then(() => showToast('Exported as Excel', 'success')).catch(() => showToast('Export failed')) }}
              onPDF={() => { exportContactsPDF(visibleContacts, { contacts: visibleContacts, positions, dottedLines, peerLines }).then(() => showToast('Exported as PDF', 'success')).catch(() => showToast('Export failed')) }}
              onPPTX={() => { exportContactsPPTX(visibleContacts, { contacts: visibleContacts, positions, dottedLines, peerLines }).then(() => showToast('Exported as PowerPoint', 'success')).catch(() => showToast('Export failed')) }}
            />
            <button onClick={cleanupLayout}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:bg-slate-100 min-h-[36px] transition-colors">
              Tidy
            </button>
            <div className="relative">
              <button onClick={() => setShowSavedMenu(m => !m)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:bg-slate-100 min-h-[36px] transition-colors flex items-center gap-1">
                Charts
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              {showSavedMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowSavedMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-slate-200 rounded-xl shadow-lg min-w-[200px] overflow-hidden">
                    <button onClick={doSaveChart}
                      className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-100 font-medium">
                      Save current chart
                    </button>
                    <button onClick={doImportChart}
                      className="w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 5L2.5 9.5M7 5l4.5 4.5M7 5v8M1 1h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Import chart…
                    </button>
                    {savedCharts.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide border-t border-slate-100 flex items-center justify-between">
                          <span>Saved</span>
                          <button onClick={doExportAllCharts} className="text-blue-400 hover:text-blue-600 font-semibold normal-case text-[10px]">Export all</button>
                        </div>
                        {savedCharts.map(ch => (
                          <div key={ch.id} className="flex items-center gap-1 px-2 py-1.5 hover:bg-slate-50">
                            <button className="flex-1 text-left text-sm text-slate-700 px-2 py-1 truncate"
                              onClick={() => {
                                if (!confirm(`Load "${ch.name}"? This replaces current chart data.`)) return
                                const store = useAppStore.getState()
                                // contactIds are resolved against live contacts — no duplicating contact data
                                const missingIds = (ch.contactIds ?? ch.chartContacts).filter(
                                  (id: string) => !store.contacts.find((x: Contact) => x.id === id)
                                )
                                if (missingIds.length > 0) {
                                  showToast(`${missingIds.length} contact(s) from this chart no longer exist`, 'error')
                                }
                                store.setChartContacts(ch.chartContacts)
                                store.setPositions(ch.positions)
                                ch.dottedLines.forEach((d: { fromId: string; toId: string }) => store.addDottedLine(d))
                                ch.peerLines.forEach((d: { fromId: string; toId: string }) => store.addPeerLine(d))
                                setActiveChartOrg(null)
                                setShowSavedMenu(false)
                                showToast(`Chart "${ch.name}" loaded`, 'success')
                              }}>
                              {ch.name}
                            </button>
                            <button onClick={() => doExportChart(ch.id)}
                              className="text-slate-300 hover:text-blue-400 p-1" title="Export">
                              <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M7 9L2.5 4.5M7 9l4.5-4.5M7 9V1M1 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </button>
                            <button onClick={() => { if (confirm(`Delete "${ch.name}"?`)) deleteChart(ch.id) }}
                              className="text-slate-300 hover:text-red-400 p-1 text-lg leading-none">×</button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Connection mode banner */}
        {connMode && (
          <div className="bg-blue-500 text-white text-sm font-medium px-4 py-2.5 flex items-center justify-between flex-shrink-0"
            style={{ borderBottom: `3px solid ${CONN_COLORS[connMode.dir]}` }}>
            <span>{CONN_LABELS[connMode.dir](connMode.sourceName)}</span>
            <button onClick={() => setConnMode(null)}
              className="text-white/80 hover:text-white text-xs px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30">
              Cancel
            </button>
          </div>
        )}

        {/* Chart scroll area */}
        <div ref={areaRef} className="flex-1 overflow-auto relative"
          style={{ touchAction: isDraggingNode ? 'none' : 'auto' }}
          onClick={() => { if (connMode) setConnMode(null); setSelectedNodeId(null) }}>

          <div ref={treeRef} className="relative origin-top-left"
            style={{ minWidth: '100%', minHeight: '100%', transform: `scale(${zoom})`, transformOrigin: 'top left' }}>

            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
            <svg ref={svgRef} className="absolute inset-0 overflow-visible" />

            {visibleContacts.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                  <circle cx="28" cy="20" r="10" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="10" cy="44" r="6"  stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="46" cy="44" r="6"  stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M28 30v4M28 34l-12 6M28 34l12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <p className="text-sm font-medium text-slate-500">
                  {activeChartOrg ? `No contacts from "${activeChartOrg}" on chart` : 'Tap contacts on the left to add them'}
                </p>
                <button onClick={() => setPanelOpen(true)}
                  className="lg:hidden px-4 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold min-h-[44px]">
                  Add contacts
                </button>
              </div>
            )}

            {/* Nodes */}
            {visibleContacts.map(c => {
              const pos = getPos(c.id)
              const isConnSource = connMode?.sourceId === c.id
              const isSelected   = selectedNodeId === c.id
              const accent       = nodeAccentColor(c.id)  // empty string when themes off
              const hasAccent    = shapeFormat === 'card-accent'

              return (
                <div key={c.id}
                  data-node-id={c.id}
                  className={`absolute select-none shadow-md overflow-visible group
                    ${nodeShapeClass()}
                    ${isConnSource ? 'ring-2 ring-blue-300' : isSelected ? 'ring-2 ring-blue-100' : ''}
                    ${connMode && !isConnSource ? 'cursor-crosshair hover:shadow-lg' : 'cursor-grab active:cursor-grabbing'}
                  `}
                  style={{
                    left: pos.x, top: pos.y,
                    width: NODE_W, minHeight: NODE_H,
                    touchAction: 'none',
                    zIndex: isSelected ? 20 : 10,
                    background: 'white',
                    border: `2px solid ${accent || (isConnSource ? '#93c5fd' : isSelected ? '#bfdbfe' : '#e2e8f0')}`,
                  }}
                  onPointerDown={e => {
                    if ((e.target as HTMLElement).closest('[data-handle],[data-action]')) return
                    if (connMode) { applyConn(c.id); return }
                    onNodePointerDown(e, c)
                  }}
                  onPointerMove={e => onNodePointerMove(e, c)}
                  onPointerUp={e => onNodePointerUp(e, c)}
                  onClick={e => {
                    if (nodeDrag.current?.moved) return
                    if (connMode) { applyConn(c.id); e.stopPropagation(); return }
                    e.stopPropagation()
                    setSelectedNodeId(prev => prev === c.id ? null : c.id)
                  }}
                >
                  {/* Card accent bar */}
                  {hasAccent && (
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl"
                      style={{ background: accent || avatarColor(c.name) }} />
                  )}

                  {/* Connection handles */}
                  {(['top','bottom','right','left'] as ConnDir[]).map(dir => (
                    <button key={dir} data-handle={dir}
                      title={CONN_LABELS[dir](c.name)}
                      onClick={e => { e.stopPropagation(); setConnMode({ sourceId: c.id, dir, sourceName: c.name }) }}
                      className={`absolute z-20 w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shadow transition-opacity
                        ${dir === 'top'    ? '-top-2.5 left-1/2 -translate-x-1/2' : ''}
                        ${dir === 'bottom' ? '-bottom-2.5 left-1/2 -translate-x-1/2' : ''}
                        ${dir === 'right'  ? 'top-1/2 -right-2.5 -translate-y-1/2' : ''}
                        ${dir === 'left'   ? 'top-1/2 -left-2.5 -translate-y-1/2' : ''}
                        ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}
                      `}
                      style={{ background: CONN_COLORS[dir] }}>
                      {dir === 'top' ? '↑' : dir === 'bottom' ? '↓' : dir === 'right' ? '⟷' : '⋯'}
                    </button>
                  ))}

                  {/* Node content */}
                  <div className={`p-2.5 flex items-center gap-2 ${hasAccent ? 'pl-4' : ''}`}>
                    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: accent || avatarColor(c.name) }}>
                      {initials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate text-slate-800">{c.name}</p>
                      {c.title && <p className="text-[10px] truncate text-slate-400">{c.title}</p>}
                      {c.level && (
                        <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                          {LEVEL_LABELS[c.level as Level] ?? c.level}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Node actions */}
                  <div className={`absolute top-1 right-1 flex gap-0.5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                    <button data-action="edit"
                      onClick={e => { e.stopPropagation(); setDrawerContactId(c.id); setSelectedNodeId(null) }}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                      <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                        <path d="M8 1.5l1.5 1.5L3 9.5H1.5V8L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <button data-action="remove"
                      onClick={e => { e.stopPropagation(); removeFromChart(c.id); setSelectedNodeId(null) }}
                      className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>

                  {/* Per-node branch style picker — shown below node when selected */}
                  {isSelected && !connMode && (
                    <div data-action="branch-picker"
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-30 bg-white border border-slate-200 rounded-xl shadow-lg p-2 flex flex-col gap-1 min-w-[160px]"
                      onClick={e => e.stopPropagation()}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide px-1 mb-0.5">Children layout</p>
                      {BRANCH_STYLES.map(bs => {
                        const active = (nodeBranchStyles[c.id] ?? branchStyle) === bs.value
                        return (
                          <button key={bs.value} data-action="branch-picker"
                            onClick={e => {
                              e.stopPropagation()
                              setNodeBranchStyles(prev => ({ ...prev, [c.id]: bs.value }))
                            }}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <span className={active ? 'text-blue-500' : 'text-slate-400'}>{bs.icon}</span>
                            {bs.label}
                            {nodeBranchStyles[c.id] === bs.value && (
                              <span className="ml-auto text-[9px] text-blue-400 font-semibold">custom</span>
                            )}
                          </button>
                        )
                      })}
                      {nodeBranchStyles[c.id] && (
                        <button data-action="branch-picker"
                          onClick={e => { e.stopPropagation(); setNodeBranchStyles(prev => { const n = {...prev}; delete n[c.id]; return n }) }}
                          className="text-[10px] text-slate-400 hover:text-slate-600 text-center py-1 border-t border-slate-100 mt-0.5">
                          Reset to default
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Bus handles — React divs so pointer capture survives SVG redraws */}
            {busHandles.map(bh => (
              <div key={bh.parentId}
                data-action="bus-handle"
                style={{
                  position: 'absolute',
                  left: bh.x - 7,
                  top:  bh.y - 7,
                  width: 14, height: 14,
                  borderRadius: '50%',
                  background: 'white',
                  border: `${lineWidth}px solid ${lineColor}`,
                  cursor: bh.axis === 'y' ? 'ns-resize' : 'ew-resize',
                  zIndex: 25,
                  touchAction: 'none',
                }}
                onPointerDown={e => {
                  e.stopPropagation()
                  const el = e.currentTarget as HTMLElement
                  el.setPointerCapture(e.pointerId)
                  busHandleDrag.current = {
                    parentId: bh.parentId,
                    axis: bh.axis,
                    startCoord: bh.axis === 'y' ? e.clientY : e.clientX,
                    startOffset: busOffsets[bh.parentId] ?? 0,
                  }
                }}
                onPointerMove={e => {
                  const drag = busHandleDrag.current
                  if (!drag || drag.parentId !== bh.parentId) return
                  const delta = (bh.axis === 'y' ? e.clientY : e.clientX) - drag.startCoord
                  const next = drag.startOffset + delta
                  busOffsetsRef.current = { ...busOffsetsRef.current, [bh.parentId]: next }
                  setBusOffsets({ ...busOffsetsRef.current })
                }}
                onPointerUp={() => { busHandleDrag.current = null }}
                onPointerCancel={() => { busHandleDrag.current = null }}
              />
            ))}
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-20">
            <button
              onClick={() => setZoom(z => Math.min(2, Math.round((z + 0.1) * 10) / 10))}
              className="w-9 h-9 bg-white border border-slate-200 rounded-xl shadow-md flex items-center justify-center text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-lg font-bold transition-colors select-none">
              +
            </button>
            <div className="text-center text-[10px] text-slate-400 font-semibold py-0.5">{Math.round(zoom * 100)}%</div>
            <button
              onClick={() => setZoom(z => Math.max(0.3, Math.round((z - 0.1) * 10) / 10))}
              className="w-9 h-9 bg-white border border-slate-200 rounded-xl shadow-md flex items-center justify-center text-slate-600 hover:bg-slate-50 active:bg-slate-100 text-lg font-bold transition-colors select-none">
              −
            </button>
          </div>
        </div>
      </div>

      <ContactDrawer
        contactId={drawerContactId ?? null}
        open={drawerContactId !== undefined}
        onClose={() => setDrawerContactId(undefined)} />
    </div>
  )
}
