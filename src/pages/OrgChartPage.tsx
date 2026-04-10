import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { avatarColor, initials, uid, LEVEL_LABELS, downloadJSON, pickFile, readFileText } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import ContactDrawer from '../components/contacts/ContactDrawer'
import type { Contact, Position } from '../types'

// ─── Constants ───────────────────────────────────────────────────────────────
const NODE_W = 200
const NODE_H = 88
const H_GAP = 54
const V_GAP = 60
const SNAP = 20

// ─── Tree layout ─────────────────────────────────────────────────────────────
function buildTreeMap(contacts: Contact[]) {
  const map: Record<string, Contact & { children: (Contact & { children: any[] })[] }> = {}
  contacts.forEach(c => { map[c.id] = { ...c, children: [] } })
  contacts.forEach(c => { if (c.parentId && map[c.parentId]) map[c.parentId].children.push(map[c.id]) })
  const roots = contacts.filter(c => !c.parentId || !map[c.parentId]).map(c => map[c.id])
  return { map, roots }
}

function computeTreeLayout(contacts: Contact[]): Record<string, Position> {
  if (!contacts.length) return {}
  const { roots } = buildTreeMap(contacts)

  function subtreeWidth(node: any): number {
    if (!node.children.length) return NODE_W
    const cw = node.children.reduce((s: number, c: any) => s + subtreeWidth(c), 0)
    return Math.max(NODE_W, cw + H_GAP * (node.children.length - 1))
  }

  const positions: Record<string, Position> = {}
  function layout(node: any, centerX: number, y: number) {
    positions[node.id] = { x: Math.round(centerX - NODE_W / 2), y }
    if (!node.children.length) return
    const totalW = node.children.reduce((s: number, c: any) => s + subtreeWidth(c), 0) + H_GAP * (node.children.length - 1)
    let cx = centerX - totalW / 2
    node.children.forEach((child: any) => {
      const sw = subtreeWidth(child)
      layout(child, cx + sw / 2, y + NODE_H + V_GAP)
      cx += sw + H_GAP
    })
  }

  let startX = 30
  roots.forEach(r => {
    const sw = subtreeWidth(r)
    layout(r, startX + sw / 2, 30)
    startX += sw + H_GAP * 2
  })
  return positions
}

function snap(v: number) { return Math.round(v / SNAP) * SNAP }

// ─── Connection modes ─────────────────────────────────────────────────────────
type ConnDir = 'top' | 'bottom' | 'right' | 'left'
interface ConnMode { sourceId: string; dir: ConnDir; sourceName: string }

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
  const [panelSearch, setPanelSearch] = useState('')
  const [panelOrg, setPanelOrg] = useState('')
  const [drawerContactId, setDrawerContactId] = useState<string | null | undefined>(undefined)
  const [showSavedMenu, setShowSavedMenu] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isDraggingNode, setIsDraggingNode] = useState(false)

  // Connection mode
  const [connMode, setConnMode] = useState<ConnMode | null>(null)

  // Drag refs (avoid re-renders during drag)
  const areaRef   = useRef<HTMLDivElement>(null)
  const treeRef   = useRef<HTMLDivElement>(null)
  const svgRef    = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const nodeDrag    = useRef<{ id: string; origX: number; origY: number; startCX: number; startCY: number; moved: boolean } | null>(null)
  const connModeRef = useRef<ConnMode | null>(null)

  // Sync connMode into ref for use in event handlers
  useEffect(() => { connModeRef.current = connMode }, [connMode])

  // Visible contacts (filtered by org)
  const chartContactObjs = contacts.filter(c => chartContacts.includes(c.id))
  const visibleContacts  = activeChartOrg
    ? chartContactObjs.filter(c => c.org === activeChartOrg)
    : chartContactObjs

  const uniqueOrgs = [...new Set(contacts.map(c => c.org).filter(Boolean) as string[])].sort()

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

    function getNodeRect(id: string) {
      const el = (tree as HTMLElement).querySelector<HTMLElement>(`[data-node-id="${id}"]`)
      if (!el) return null
      return {
        x: parseInt(el.style.left) || 0,
        y: parseInt(el.style.top) || 0,
        w: el.offsetWidth  || NODE_W,
        h: el.offsetHeight || NODE_H,
      }
    }

    function drawLine(fromId: string, toId: string, style: 'solid' | 'dashed' | 'peer', onDelete: () => void) {
      const p  = getNodeRect(fromId)
      const ch = getNodeRect(toId)
      if (!p || !ch) return

      let pathD: string, strokeColor: string
      if (style === 'peer') {
        const left  = p.x < ch.x ? p  : ch
        const right = p.x < ch.x ? ch : p
        const y1 = left.y  + left.h  / 2
        const y2 = right.y + right.h / 2
        const x1 = left.x  + left.w
        const x2 = right.x
        const midX = (x1 + x2) / 2
        pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
        strokeColor = '#f59e0b'
      } else {
        const x1 = p.x  + p.w  / 2, y1 = p.y  + p.h
        const x2 = ch.x + ch.w / 2, y2 = ch.y
        const midY = (y1 + y2) / 2
        pathD = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
        strokeColor = style === 'dashed' ? '#8b5cf6' : '#cbd5e1'
      }

      const visPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      visPath.setAttribute('d', pathD)
      visPath.setAttribute('stroke', strokeColor)
      visPath.setAttribute('stroke-width', '1.5')
      visPath.setAttribute('fill', 'none')
      visPath.setAttribute('stroke-linecap', 'round')
      visPath.setAttribute('stroke-linejoin', 'round')
      visPath.setAttribute('pointer-events', 'none')
      if (style === 'dashed') visPath.setAttribute('stroke-dasharray', '5,4')
      if (style === 'peer')   visPath.setAttribute('stroke-dasharray', '6,3')
      ;(svg as SVGSVGElement).appendChild(visPath)

      const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hitPath.setAttribute('d', pathD)
      hitPath.setAttribute('stroke', 'transparent')
      hitPath.setAttribute('stroke-width', '16')
      hitPath.setAttribute('fill', 'none')
      hitPath.setAttribute('cursor', 'pointer')
      hitPath.setAttribute('pointer-events', 'stroke')
      hitPath.style.cursor = 'pointer'
      hitPath.addEventListener('click', e => {
        e.stopPropagation()
        if (confirm('Remove this connection?')) { onDelete() }
      })
      hitPath.addEventListener('mouseenter', () => {
        visPath.setAttribute('stroke', '#ef4444')
        visPath.setAttribute('stroke-width', '2.5')
      })
      hitPath.addEventListener('mouseleave', () => {
        visPath.setAttribute('stroke', strokeColor)
        visPath.setAttribute('stroke-width', '1.5')
      })
      ;(svg as SVGSVGElement).appendChild(hitPath)
    }

    // Solid reporting lines
    contacts.forEach(c => {
      if (c.parentId && visibleIds.has(c.id) && visibleIds.has(c.parentId)) {
        drawLine(c.parentId, c.id, 'solid', () => {
          updateContact({ ...c, parentId: undefined })
        })
      }
    })
    // Dotted lines
    dottedLines.forEach(dl => {
      if (visibleIds.has(dl.fromId) && visibleIds.has(dl.toId)) {
        drawLine(dl.fromId, dl.toId, 'dashed', () => removeDottedLine(dl.fromId, dl.toId))
      }
    })
    // Peer lines
    peerLines.forEach(pl => {
      if (visibleIds.has(pl.fromId) && visibleIds.has(pl.toId)) {
        drawLine(pl.fromId, pl.toId, 'peer', () => removePeerLine(pl.fromId, pl.toId))
      }
    })
  }, [visibleContacts, contacts, dottedLines, peerLines, updateContact, removeDottedLine, removePeerLine])

  // Resize / redraw after render
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

  // ─── Add contact to chart ───────────────────────────────────────────────────
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

  // ─── Remove from chart ─────────────────────────────────────────────────────
  const removeFromChart = (id: string) => {
    const c = contacts.find(x => x.id === id)
    const newPos = { ...positions }; delete newPos[id]
    setPositions(newPos)
    setChartContacts(chartContacts.filter(x => x !== id))
    contacts.filter(x => x.parentId === id).forEach(x => updateContact({ ...x, parentId: undefined }))
    showToast(`${c?.name ?? 'Contact'} removed from chart`)
  }

  // ─── Auto-layout ───────────────────────────────────────────────────────────
  const cleanupLayout = () => {
    const fresh = computeTreeLayout(visibleContacts)
    setPositions({ ...positions, ...fresh })
    showToast('Layout cleaned up', 'success')
  }

  // ─── Save chart ────────────────────────────────────────────────────────────
  const doSaveChart = () => {
    const name = prompt('Name this chart:', activeChartOrg || 'My Chart')
    if (!name) return
    saveChart({
      id: uid(), name,
      savedAt: new Date().toISOString(),
      contacts: contacts.map(c => ({ ...c })),
      dottedLines: dottedLines.map(d => ({ ...d })),
      peerLines:   peerLines.map(d => ({ ...d })),
      chartContacts: [...chartContacts],
      positions: { ...positions },
    })
    showToast(`Chart "${name}" saved`, 'success')
    setShowSavedMenu(false)
  }

  // ─── Export / import charts ────────────────────────────────────────────────
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
        saveChart({ ...ch, id: uid(), savedAt: new Date().toISOString() })
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
      const el = e.currentTarget as HTMLElement
      el.style.left = Math.max(0, d.origX + dx) + 'px'
      el.style.top  = Math.max(0, d.origY + dy) + 'px'
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
      // Tap on touch: toggle selected state to reveal handles/actions
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

  // ─── Positions: fall back to auto-layout if not set ────────────────────────
  const layoutFallback = computeTreeLayout(visibleContacts)
  const getPos = (id: string): Position => positions[id] || layoutFallback[id] || { x: 20, y: 20 }

  // ─── Connection bar labels ──────────────────────────────────────────────────
  const CONN_LABELS: Record<ConnDir, (name: string) => string> = {
    top:    n => `${n} will report to…`,
    bottom: n => `…will report to ${n}`,
    right:  n => `Peer of ${n}…`,
    left:   n => `Dotted-line from ${n}…`,
  }
  const CONN_COLORS: Record<ConnDir, string> = {
    top: '#3b82f6', bottom: '#10b981', right: '#f59e0b', left: '#8b5cf6'
  }

  return (
    <div className="h-full flex overflow-hidden bg-slate-100">

      {/* ── Left panel (desktop sidebar / mobile bottom sheet) ── */}
      <>
        {/* Mobile: overlay */}
        {panelOpen && (
          <div className="lg:hidden fixed inset-0 bg-black/30 z-20" onClick={() => setPanelOpen(false)} />
        )}

        {/* Panel */}
        <div className={`
          fixed lg:static z-30
          flex flex-col bg-white border-r border-slate-200
          transition-transform duration-300
          lg:translate-x-0 lg:w-64 lg:flex-shrink-0 lg:h-full
          inset-x-0 bottom-0 rounded-t-2xl max-h-[80dvh]
          lg:inset-auto lg:rounded-none lg:max-h-full
          ${panelOpen ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
        `}>
          {/* Mobile drag handle */}
          <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 bg-slate-200 rounded-full" />
          </div>

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
            {/* Org pills */}
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
        </div>
      </>

      {/* ── Main chart area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="bg-white border-b border-slate-200 flex-shrink-0 px-3 py-2 flex items-center gap-2 flex-wrap">

          {/* Mobile: panel toggle */}
          <button onClick={() => setPanelOpen(p => !p)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium min-h-[40px] active:bg-slate-50">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.4"/>
              <circle cx="5" cy="10" r="2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M9 4h4M9 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            Contacts
          </button>

          {/* Org filter pills */}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide flex-1">
            {[null, ...uniqueOrgs].map(org => (
              <button key={org ?? '__all'} onClick={() => setActiveChartOrg(org)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap border flex-shrink-0 transition-colors ${activeChartOrg === org ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                {org ?? 'All'}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
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
                                ch.contacts.forEach(c => {
                                  if (!store.contacts.find(x => x.id === c.id)) store.addContact(c)
                                })
                                store.setChartContacts(ch.chartContacts)
                                store.setPositions(ch.positions)
                                ch.dottedLines.forEach(d => store.addDottedLine(d))
                                ch.peerLines.forEach(d => store.addPeerLine(d))
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

        {/* Chart scroll area — lock scroll while dragging a node on touch */}
        <div ref={areaRef} className="flex-1 overflow-auto relative"
          style={{ touchAction: isDraggingNode ? 'none' : 'auto' }}
          onClick={() => { if (connMode) setConnMode(null); setSelectedNodeId(null) }}>

          {/* Relative container for nodes + SVG */}
          <div ref={treeRef} className="relative" style={{ minWidth: '100%', minHeight: '100%' }}>

            {/* Dot grid canvas */}
            <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />

            {/* SVG connections layer — pointer-events on so hit paths are clickable */}
            <svg ref={svgRef} className="absolute inset-0 overflow-visible" />

            {/* Empty state */}
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
              return (
                <div key={c.id}
                  data-node-id={c.id}
                  className={`absolute select-none bg-white border-2 rounded-xl shadow-md overflow-visible group
                    ${isConnSource ? 'border-blue-400 ring-2 ring-blue-200' : isSelected ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'}
                    ${connMode && !isConnSource ? 'cursor-crosshair hover:border-blue-400 hover:shadow-lg' : 'cursor-grab active:cursor-grabbing'}
                  `}
                  style={{ left: pos.x, top: pos.y, width: NODE_W, minHeight: NODE_H, touchAction: 'none', zIndex: isSelected ? 20 : 10 }}
                  onPointerDown={e => {
                    if ((e.target as HTMLElement).closest('[data-handle],[data-action]')) return
                    if (connMode) { applyConn(c.id); return }
                    onNodePointerDown(e, c)
                  }}
                  onPointerMove={e => onNodePointerMove(e, c)}
                  onPointerUp={e => onNodePointerUp(e, c)}
                  onClick={e => {
                    if (nodeDrag.current?.moved) return
                    if (connMode) { applyConn(c.id); e.stopPropagation() }
                  }}
                >
                  {/* Connection handles — always visible when selected on touch */}
                  {(['top','bottom','right','left'] as ConnDir[]).map(dir => (
                    <button key={dir} data-handle={dir}
                      title={CONN_LABELS[dir](c.name)}
                      onClick={e => { e.stopPropagation(); setConnMode({ sourceId: c.id, dir, sourceName: c.name }) }}
                      className={`absolute z-20 w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm transition-opacity
                        ${dir === 'top'    ? '-top-3 left-1/2 -translate-x-1/2' : ''}
                        ${dir === 'bottom' ? '-bottom-3 left-1/2 -translate-x-1/2' : ''}
                        ${dir === 'right'  ? 'top-1/2 -right-3 -translate-y-1/2' : ''}
                        ${dir === 'left'   ? 'top-1/2 -left-3 -translate-y-1/2' : ''}
                        ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}
                      `}
                      style={{ background: CONN_COLORS[dir] }}>
                      {dir === 'top' ? '↑' : dir === 'bottom' ? '↓' : dir === 'right' ? '⟷' : '⋯'}
                    </button>
                  ))}

                  {/* Node content */}
                  <div className="p-2.5 flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: avatarColor(c.name) }}>
                      {initials(c.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate">{c.name}</p>
                      {c.title && <p className="text-[10px] text-slate-400 truncate">{c.title}</p>}
                      {c.level && (
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">
                          {LEVEL_LABELS[c.level] ?? c.level}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Node actions — always visible when selected */}
                  <div className={`absolute top-1 right-1 flex gap-0.5 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                    <button data-action="edit"
                      onClick={e => { e.stopPropagation(); setDrawerContactId(c.id); setSelectedNodeId(null) }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 bg-white/90 shadow-sm">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M8 1.5l1.5 1.5L3 9.5H1.5V8L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    <button data-action="remove"
                      onClick={e => { e.stopPropagation(); removeFromChart(c.id); setSelectedNodeId(null) }}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 bg-white/90 shadow-sm">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Contact drawer */}
      <ContactDrawer
        contactId={drawerContactId ?? null}
        open={drawerContactId !== undefined}
        onClose={() => setDrawerContactId(undefined)} />
    </div>
  )
}
