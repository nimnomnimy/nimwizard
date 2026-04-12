import React, { useState, useCallback, useRef } from 'react'
import { uid } from '../../lib/utils'
import { useCurrency } from '../../store/useCurrency'
import type {
  ProductConfiguration, ConfigGroup, ConfigRow, ConfigChild,
  ConfigRowUnit, ConfigGroupPricingType,
} from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const RECURRING_UNITS: ConfigRowUnit[] = ['months', 'years', 'per unit', 'per site', 'per user']

function emptyRow(): ConfigRow {
  return { id: uid(), description: '', quantity: 1, costPriceUsd: 0, floorPriceUsd: 0, sellPriceUsd: 0 }
}

function emptyGroup(label = '', pricingType: ConfigGroupPricingType = 'one-time'): ConfigGroup {
  return { id: uid(), label, collapsed: false, pricingType, defaultUnit: 'months', children: [] }
}

function emptyConfig(): ProductConfiguration {
  const g = emptyGroup('Group 1')
  g.children = [{ type: 'row', row: emptyRow() }]
  return { id: uid(), name: 'New Configuration', currency: 'USD', groups: [g], createdAt: Date.now(), updatedAt: Date.now() }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function rowsOf(g: ConfigGroup): ConfigRow[] {
  return (g.children ?? []).filter((c): c is { type: 'row'; row: ConfigRow } => c.type === 'row').map(c => c.row)
}

function subGroupsOf(g: ConfigGroup): ConfigGroup[] {
  return (g.children ?? []).filter((c): c is { type: 'subgroup'; group: ConfigGroup } => c.type === 'subgroup').map(c => c.group)
}

function rowNetUsd(row: ConfigRow): number {
  return (row.sellPriceUsd ?? 0) * (1 - (row.discountPct ?? 0) / 100)
}

// groupSubtotal: sum of (net × rowQty × term) for rows directly/indirectly in this group,
// WITHOUT applying the group's own qty multiplier. Used for displaying the group's "Net" field.
function groupSubtotal(g: ConfigGroup): number {
  const isRecurring = g.pricingType === 'recurring'
  return (g.children ?? []).reduce((s, c) => {
    if (c.type === 'row') return s + rowNetUsd(c.row) * (c.row.quantity ?? 1) * (isRecurring ? (c.row.termMonths ?? 1) : 1)
    // sub-group: subtotal × sub-group's own qty
    return s + groupSubtotal(c.group) * (c.group.qty ?? 1)
  }, 0)
}

// groupTotal: subtotal × this group's qty — the full contribution of this group
function groupTotal(g: ConfigGroup): number {
  return groupSubtotal(g) * (g.qty ?? 1)
}

// Apply a discount % to every row in a group (and its sub-groups) recursively
function applyGroupDiscount(g: ConfigGroup, discPct: number): ConfigGroup {
  return {
    ...g,
    discountPct: discPct,
    children: (g.children ?? []).map(c => {
      if (c.type === 'row') return { type: 'row', row: { ...c.row, discountPct: discPct } }
      return { type: 'subgroup', group: applyGroupDiscount(c.group, discPct) }
    }),
  }
}

// Build a flat list of move destinations for a given config, excluding the current group/subgroup
function buildDestinations(
  cfg: ProductConfiguration,
  excludeGroupId: string,
): { id: string; label: string; indent: number }[] {
  const result: { id: string; label: string; indent: number }[] = []
  for (const g of cfg.groups) {
    if (g.id !== excludeGroupId) result.push({ id: g.id, label: g.label || '(group)', indent: 0 })
    for (const c of (g.children ?? [])) {
      if (c.type === 'subgroup' && c.group.id !== excludeGroupId) {
        result.push({ id: c.group.id, label: `${g.label ? g.label + ' › ' : ''}${c.group.label || '(sub-group)'}`, indent: 1 })
      }
    }
  }
  return result
}

// Find a group by id anywhere in the config tree; returns [group, parent|null]
function findGroup(cfg: ProductConfiguration, id: string): { group: ConfigGroup; parentGroup: ConfigGroup | null } | null {
  for (const g of cfg.groups) {
    if (g.id === id) return { group: g, parentGroup: null }
    for (const c of (g.children ?? [])) {
      if (c.type === 'subgroup' && c.group.id === id) return { group: c.group, parentGroup: g }
    }
  }
  return null
}

// Deep-update a group anywhere in the tree by id
function updateGroupInConfig(cfg: ProductConfiguration, updated: ConfigGroup): ProductConfiguration {
  function updateInGroup(g: ConfigGroup): ConfigGroup {
    if (g.id === updated.id) return updated
    return { ...g, children: (g.children ?? []).map(c => c.type === 'subgroup' ? { type: 'subgroup', group: updateInGroup(c.group) } : c) }
  }
  return { ...cfg, groups: cfg.groups.map(g => updateInGroup(g)) }
}

// ─── Paste parser ─────────────────────────────────────────────────────────────

function parseExcelPaste(text: string, fxRate: number, inputIsAud: boolean): { groups: ConfigGroup[] } | null {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())
  const colIdx = (names: string[]) => { for (const n of names) { const i = headers.findIndex(h => h.includes(n)); if (i >= 0) return i } return -1 }
  const iDesc = colIdx(['description', 'desc'])
  const iQty  = colIdx(['quantity', 'qty'])
  const iCost = colIdx(['cost price', 'cost'])
  const iFloor = colIdx(['floor price', 'floor'])
  const iSell = colIdx(['sell price', 'sell'])
  const iUnit = colIdx(['unit'])
  const iTerm = colIdx(['term'])
  const iPCode = colIdx(['productid', 'product id', 'product code', 'code'])
  if (iDesc < 0) return null
  const toUsd = (raw: string) => { const n = parseFloat(raw.replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : (inputIsAud ? n / fxRate : n) }
  const groups: ConfigGroup[] = []
  let curTop: ConfigGroup | null = null
  let curSub: ConfigGroup | null = null
  for (let li = 1; li < lines.length; li++) {
    const c = lines[li].split('\t').map(x => x.trim())
    const desc  = iDesc >= 0 ? c[iDesc] ?? '' : ''
    const code  = iPCode >= 0 ? c[iPCode] ?? '' : ''
    const qty   = iQty >= 0 ? parseFloat(c[iQty] ?? '1') || 1 : 1
    const cost  = iCost >= 0 ? toUsd(c[iCost] ?? '0') : 0
    const floor = iFloor >= 0 ? toUsd(c[iFloor] ?? '0') : 0
    const sell  = iSell >= 0 ? toUsd(c[iSell] ?? '0') : 0
    const rawUnit = (iUnit >= 0 ? c[iUnit] ?? '' : '').toLowerCase()
    const unit: ConfigRowUnit | undefined = RECURRING_UNITS.find(u => u === rawUnit)
    const term  = iTerm >= 0 ? parseInt(c[iTerm] ?? '1') || undefined : undefined
    const isHeader = code === '' && desc !== '' && cost === 0 && floor === 0 && sell === 0
    if (isHeader) {
      // Detect recurring by unit column presence
      const pt: ConfigGroupPricingType = unit ? 'recurring' : 'one-time'
      if (!curTop) {
        curTop = emptyGroup(desc, pt); curTop.children = []; curSub = null; groups.push(curTop)
      } else {
        curSub = emptyGroup(desc, pt); curSub.children = []; curTop.children.push({ type: 'subgroup', group: curSub })
      }
      continue
    }
    if (!desc && !code) continue
    const row: ConfigRow = { id: uid(), productCode: code || undefined, description: desc, quantity: qty, costPriceUsd: cost, floorPriceUsd: floor, sellPriceUsd: sell, unit, termMonths: term }
    const target = curSub ?? curTop
    if (target) target.children.push({ type: 'row', row })
    else { curTop = emptyGroup('Group 1'); curTop.children = [{ type: 'row', row }]; groups.push(curTop) }
  }
  return groups.length > 0 ? { groups } : null
}

// ─── Column widths ────────────────────────────────────────────────────────────

// Indices: 0=code, 1=desc, 2=qty, 3=cost, 4=floor, 5=sell, 6=unit, 7=term, 8=total, 9=disc%, 10=net
const DEFAULT_COL_WIDTHS = [90, 200, 50, 78, 78, 78, 72, 52, 84, 56, 78] as const
type ColWidths = [number, number, number, number, number, number, number, number, number, number, number]

const COL_LABELS = ['Code', 'Description', 'Qty', 'Cost', 'Floor', 'Sell', 'Unit', 'Term', 'Total', 'Disc%', 'Net'] as const
// Cost (3) and Floor (4) hidden by default
const DEFAULT_HIDDEN_COLS = new Set([3, 4])

function colPx(w: ColWidths, idx: number, hidden: Set<number>): string {
  return hidden.has(idx) ? '0px' : `${w[idx]}px`
}

function buildColTemplate(w: ColWidths, isRecurring: boolean, hidden: Set<number> = new Set()): string {
  // Fixed: checkbox(20) drag(8) | resizable cols | fixed: delete(28)
  const recurring = isRecurring ? `${colPx(w, 6, hidden)} ${colPx(w, 7, hidden)} ` : ''
  return `20px 8px ${colPx(w, 0, hidden)} ${colPx(w, 1, hidden)} ${colPx(w, 2, hidden)} ${colPx(w, 3, hidden)} ${colPx(w, 4, hidden)} ${colPx(w, 5, hidden)} ${recurring}${colPx(w, 9, hidden)} ${colPx(w, 10, hidden)} ${colPx(w, 8, hidden)} 28px`
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  configs: ProductConfiguration[]
  onChange: (configs: ProductConfiguration[]) => void
  activeConfigId?: string | null
  onActiveConfigChange?: (id: string | null) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProductConfigEditor({ configs, onChange, activeConfigId: controlledActiveId, onActiveConfigChange }: Props) {
  const [internalActiveId, setInternalActiveId] = useState<string | null>(configs[0]?.id ?? null)
  const activeConfigId = controlledActiveId !== undefined ? controlledActiveId : internalActiveId
  function setActiveConfigId(id: string | null) {
    setInternalActiveId(id)
    onActiveConfigChange?.(id)
  }

  const [editingConfigName, setEditingConfigName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const pasteAreaRef = useRef<HTMLTextAreaElement>(null)

  // Column widths (resizable), hidden columns, and overall table width
  const [colWidths, setColWidths] = useState<ColWidths>([...DEFAULT_COL_WIDTHS] as ColWidths)
  const [hiddenCols, setHiddenCols] = useState<Set<number>>(new Set(DEFAULT_HIDDEN_COLS))
  const [showColMenu, setShowColMenu] = useState(false)
  const [tableWidth, setTableWidth] = useState<number | null>(null)
  const tableContainerRef = useRef<HTMLDivElement>(null)

  function toggleCol(idx: number) {
    setHiddenCols(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  function handleColResize(colIdx: number, delta: number) {
    setColWidths(prev => {
      const next = [...prev] as ColWidths
      next[colIdx] = Math.max(30, prev[colIdx] + delta)
      return next
    })
  }

  function handleTableResize(delta: number) {
    setTableWidth(prev => {
      const base = prev ?? (tableContainerRef.current?.offsetWidth ?? 600)
      return Math.max(400, base + delta)
    })
  }

  const usdToAudRate  = useCurrency(s => s.usdToAudRate)
  const currency      = useCurrency(s => s.currency)
  const fmt           = useCurrency(s => s.fmt)
  const fmtAud        = useCurrency(s => s.fmtAud)
  const showSecondary = useCurrency(s => s.showSecondary)
  // Global currency mode: AUD mode means inputs are in AUD
  const inputIsAud    = currency === 'AUD'

  const activeConfig = configs.find(c => c.id === activeConfigId) ?? null

  const updateConfig = useCallback((updated: ProductConfiguration) => {
    onChange(configs.map(c => c.id === updated.id ? { ...updated, updatedAt: Date.now() } : c))
  }, [configs, onChange])

  // kept for potential future use (e.g. pricebook multi-config)
  const _addConfig = () => { const c = emptyConfig(); onChange([...configs, c]); setActiveConfigId(c.id) }
  void _addConfig

  function addTopGroup(cfg: ProductConfiguration) {
    updateConfig({ ...cfg, groups: [...cfg.groups, emptyGroup(`Group ${cfg.groups.length + 1}`)] })
  }

  function reorderTopGroups(cfg: ProductConfiguration, from: number, to: number) {
    updateConfig({ ...cfg, groups: reorder(cfg.groups, from, to) })
  }

  function deleteTopGroup(cfg: ProductConfiguration, groupId: string) {
    updateConfig({ ...cfg, groups: cfg.groups.filter(g => g.id !== groupId) })
  }

  // Move selected row IDs from sourceGroupId to destGroupId (append at end)
  function moveRowsToGroup(cfg: ProductConfiguration, rowIds: Set<string>, sourceGroupId: string, destGroupId: string) {
    const found = findGroup(cfg, sourceGroupId)
    if (!found) return
    const destFound = findGroup(cfg, destGroupId)
    if (!destFound) return
    const rowsToMove = (found.group.children ?? []).filter(c => c.type === 'row' && rowIds.has(c.row.id))
    const updatedSource: ConfigGroup = { ...found.group, children: (found.group.children ?? []).filter(c => !(c.type === 'row' && rowIds.has(c.row.id))) }
    const updatedDest: ConfigGroup = { ...destFound.group, children: [...(destFound.group.children ?? []), ...rowsToMove] }
    let next = updateGroupInConfig(cfg, updatedSource)
    next = updateGroupInConfig(next, updatedDest)
    updateConfig(next)
  }

  function applyPaste(cfg: ProductConfiguration) {
    const result = parseExcelPaste(pasteText, usdToAudRate, inputIsAud)
    if (!result) { setPasteError('Could not parse. Ensure the first row is a header with at least a "Description" column.'); return }
    updateConfig({ ...cfg, groups: result.groups })
    setPasteOpen(false); setPasteText(''); setPasteError('')
  }

  if (!activeConfig) return null

  return (
    <div className="flex flex-col gap-3">

      {activeConfig && (
        <div
          ref={tableContainerRef}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden relative"
          style={tableWidth ? { width: tableWidth } : undefined}
        >
          {/* Toolbar */}
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2 flex-wrap">
            {editingConfigName === activeConfig.id ? (
              <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                onBlur={() => { updateConfig({ ...activeConfig, name: nameInput.trim() || activeConfig.name }); setEditingConfigName(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { updateConfig({ ...activeConfig, name: nameInput.trim() || activeConfig.name }); setEditingConfigName(null) } if (e.key === 'Escape') setEditingConfigName(null) }}
                className="text-sm font-bold text-slate-800 border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white" />
            ) : (
              <button onClick={() => { setEditingConfigName(activeConfig.id); setNameInput(activeConfig.name) }}
                className="text-sm font-bold text-slate-800 hover:text-blue-600 transition-colors">
                {activeConfig.name} ✎
              </button>
            )}
            {/* Columns visibility dropdown */}
            <div className="relative ml-auto">
              <button onClick={() => setShowColMenu(v => !v)}
                className={`text-[11px] px-2 py-1 rounded-lg font-semibold border transition-colors ${showColMenu ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                Columns{hiddenCols.size > 0 ? ` (${hiddenCols.size} hidden)` : ''}
              </button>
              {showColMenu && (
                <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-2 flex flex-col gap-0.5 min-w-[130px]"
                  onMouseLeave={() => setShowColMenu(false)}>
                  {COL_LABELS.map((label, idx) => (
                    <label key={idx} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer text-xs text-slate-600 font-medium select-none">
                      <input type="checkbox" checked={!hiddenCols.has(idx)} onChange={() => toggleCol(idx)} className="w-3 h-3 cursor-pointer" />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setPasteOpen(v => !v)}
              className={`text-[11px] px-2 py-1 rounded-lg font-semibold border transition-colors ${pasteOpen ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              Paste Excel
            </button>
            <button onClick={() => addTopGroup(activeConfig)}
              className="text-[11px] px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:border-slate-300 font-semibold transition-colors">
              + Group
            </button>
          </div>

          {/* Paste area */}
          {pasteOpen && (
            <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 flex flex-col gap-2">
              <p className="text-xs text-amber-700 font-semibold">
                Paste your Excel table (or use <strong>Export Config Excel</strong> to get the right format).
                First row must be headers — required: <em>Description</em>.
                Optional columns: <em>ProductID, Quantity, Cost Price, Floor Price, Sell Price, Disc%, Unit, Term</em>.
                Rows with no ProductID and no prices become group or sub-group headers.
                Disc% is ignored on paste — set it in the table after importing.
              </p>
              <textarea ref={pasteAreaRef} value={pasteText} onChange={e => { setPasteText(e.target.value); setPasteError('') }}
                rows={5} placeholder="Paste Excel content here (Ctrl+V)…"
                className="w-full font-mono text-xs border border-amber-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-y" />
              {pasteError && <p className="text-xs text-red-600">{pasteError}</p>}
              <div className="flex gap-2">
                <button onClick={() => applyPaste(activeConfig)} className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors">Apply</button>
                <button onClick={() => { setPasteOpen(false); setPasteText(''); setPasteError('') }} className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* Groups */}
          {activeConfig.groups.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">No groups yet. Click <strong>+ Group</strong> to add one.</div>
          ) : (
            <div className="flex flex-col">
              {/* Sticky column header */}
              <div className="sticky top-0 z-20">
                <ConfigTableHeader
                  isRecurring={activeConfig.groups.some(g => g.pricingType === 'recurring')}
                  colWidths={colWidths} onColResize={handleColResize} hiddenCols={hiddenCols}
                />
              </div>
              {/* Scrollable groups area */}
              <div className="divide-y divide-slate-100 overflow-y-auto" style={{ maxHeight: 520 }}>
                {activeConfig.groups.map((group, gi) => (
                  <TopGroupBlock
                    key={group.id}
                    group={group}
                    groupIndex={gi}
                    totalGroups={activeConfig.groups.length}
                    cfg={activeConfig}
                    inputIsAud={inputIsAud}
                    onUpdate={g => updateConfig(updateGroupInConfig(activeConfig, g))}
                    onDelete={() => deleteTopGroup(activeConfig, group.id)}
                    onMoveGroup={(from, to) => reorderTopGroups(activeConfig, from, to)}
                    onMoveRows={(rowIds, destGroupId) => moveRowsToGroup(activeConfig, rowIds, group.id, destGroupId)}
                    fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                    colWidths={colWidths} onColResize={handleColResize} hiddenCols={hiddenCols}
                  />
                ))}
              </div>
            </div>
          )}

          <ConfigTotalsFooter config={activeConfig} inputIsAud={inputIsAud} fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate} />

          {/* Table width resize handle */}
          <TableWidthHandle onResize={handleTableResize} />
        </div>
      )}
    </div>
  )
}

// ─── Resize handles ───────────────────────────────────────────────────────────

function ColResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startX = useRef<number | null>(null)

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    startX.current = e.clientX
    function onMove(me: MouseEvent) {
      if (startX.current === null) return
      const delta = me.clientX - startX.current
      startX.current = me.clientX
      onResize(delta)
    }
    function onUp() {
      startX.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 flex items-center justify-center group"
    >
      <div className="w-px h-3/4 bg-transparent group-hover:bg-blue-400 transition-colors" />
    </div>
  )
}

function TableWidthHandle({ onResize }: { onResize: (delta: number) => void }) {
  const startX = useRef<number | null>(null)
  const [active, setActive] = useState(false)

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    startX.current = e.clientX
    setActive(true)
    function onMove(me: MouseEvent) {
      if (startX.current === null) return
      const delta = me.clientX - startX.current
      startX.current = me.clientX
      onResize(delta)
    }
    function onUp() {
      startX.current = null
      setActive(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      title="Drag to resize table width"
      className={`flex items-center justify-center h-5 cursor-col-resize select-none border-t border-slate-100 transition-colors ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
    >
      <div className={`w-8 h-1 rounded-full transition-colors ${active ? 'bg-blue-400' : 'bg-slate-200 hover:bg-slate-400'}`} />
    </div>
  )
}

// ─── Top-level group ──────────────────────────────────────────────────────────

function TopGroupBlock({
  group, groupIndex, totalGroups, cfg, inputIsAud, onUpdate, onDelete, onMoveGroup, onMoveRows,
  fmt, fmtAud, showSecondary, usdToAudRate, colWidths, onColResize, hiddenCols,
}: {
  group: ConfigGroup; groupIndex: number; totalGroups: number; cfg: ProductConfiguration
  inputIsAud: boolean
  onUpdate: (g: ConfigGroup) => void; onDelete: () => void
  onMoveGroup: (from: number, to: number) => void
  onMoveRows: (rowIds: Set<string>, destGroupId: string) => void
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
  colWidths: ColWidths; onColResize: (idx: number, delta: number) => void; hiddenCols: Set<number>
}) {
  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(group.label)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupDiscInput, setGroupDiscInput] = useState(() => (group.discountPct ?? 0).toFixed(1))
  const [groupQtyInput, setGroupQtyInput] = useState(() => String(group.qty ?? 1))
  // dragFrom: index being dragged; if that index is a selected row, ALL selected rows move together
  const dragFrom = useRef<number | null>(null)

  const isRecurring = group.pricingType === 'recurring'
  const subtotal   = groupSubtotal(group)         // net × rowQty × term — before group qty
  const total      = subtotal * (group.qty ?? 1)  // × group qty
  const dispSubtotal = inputIsAud ? subtotal * usdToAudRate : subtotal
  const dispTotal  = inputIsAud ? total * usdToAudRate : total
  const dispFmt    = inputIsAud ? fmtAud : fmt
  const secFmt     = inputIsAud ? fmt : fmtAud

  const headerColors = ['bg-violet-50 border-b border-violet-100','bg-fuchsia-50 border-b border-fuchsia-100','bg-indigo-50 border-b border-indigo-100','bg-cyan-50 border-b border-cyan-100']
  const headerBg = headerColors[groupIndex % headerColors.length]

  function commitLabel() { onUpdate({ ...group, label: labelVal.trim() || group.label }); setEditLabel(false) }

  function applyGroupDisc(val: string) {
    const d = parseFloat(val)
    if (!isNaN(d)) {
      const clamped = Math.max(0, Math.min(100, d))
      onUpdate(applyGroupDiscount(group, clamped))
      setGroupDiscInput(clamped.toFixed(1))
    } else {
      setGroupDiscInput((group.discountPct ?? 0).toFixed(1))
    }
  }

  // Editing the group Net directly: back-calculate discount so that
  // all rows get a uniform disc% that makes groupSubtotal = enteredNet
  function applyGroupNet(val: string) {
    const net = parseFloat(val)
    const toUsd = (v: number) => inputIsAud ? v / usdToAudRate : v
    const netUsd = toUsd(net)
    // sellSubtotal = sum of sell×qty×term (disc=0)
    const sellSubtotal = (() => {
      const gg = applyGroupDiscount(group, 0)
      return groupSubtotal(gg)
    })()
    if (!isNaN(net) && sellSubtotal > 0) {
      const newDisc = Math.max(0, Math.min(100, (1 - netUsd / sellSubtotal) * 100))
      onUpdate(applyGroupDiscount(group, newDisc))
      setGroupDiscInput(newDisc.toFixed(1))
    }
  }

  function applyGroupQty(val: string) {
    const q = parseInt(val)
    if (!isNaN(q) && q > 0) {
      onUpdate({ ...group, qty: q })
      setGroupQtyInput(String(q))
    } else {
      setGroupQtyInput(String(group.qty ?? 1))
    }
  }

  function addRow() { onUpdate({ ...group, children: [...(group.children ?? []), { type: 'row', row: emptyRow() }] }) }

  function addSubGroup() {
    const sg = emptyGroup(`Sub-group ${subGroupsOf(group).length + 1}`, group.pricingType)
    sg.children = [{ type: 'row', row: emptyRow() }]
    // Insert at position 0 so the new sub-group appears at the top
    onUpdate({ ...group, children: [{ type: 'subgroup', group: sg }, ...(group.children ?? [])] })
  }

  function updateChild(idx: number, child: ConfigChild) {
    const next = [...(group.children ?? [])]; next[idx] = child
    onUpdate({ ...group, children: next })
  }

  function deleteChild(idx: number) {
    onUpdate({ ...group, children: (group.children ?? []).filter((_, i) => i !== idx) })
  }

  function reorderChildren(from: number, to: number) {
    const children = group.children ?? []
    const draggingSelected = children[from]?.type === 'row' && selected.has((children[from] as {type:'row';row:ConfigRow}).row.id)
    if (draggingSelected && selected.size > 1) {
      const moving = children.filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id))
      const rest   = children.filter(c => !(c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)))
      const beforeTo = children.slice(0, to).filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)).length
      const insertAt = Math.min(Math.max(0, to - beforeTo), rest.length)
      onUpdate({ ...group, children: [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)] })
    } else {
      onUpdate({ ...group, children: reorder(children, from, to) })
    }
  }

  function promoteToSubGroup() {
    if (selected.size === 0) return
    const children = group.children ?? []
    const firstIdx = children.findIndex(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id))
    if (firstIdx < 0) return
    const rowsToMove = children.filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id))
    const remaining = children.filter(c => !(c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)))
    const sg = emptyGroup(`Sub-group ${subGroupsOf(group).length + 1}`, group.pricingType)
    sg.children = rowsToMove
    const insertAt = Math.min(firstIdx, remaining.length)
    const next = [...remaining.slice(0, insertAt), { type: 'subgroup' as const, group: sg }, ...remaining.slice(insertAt)]
    onUpdate({ ...group, children: next })
    setSelected(new Set())
  }

  function deleteSelected() {
    if (selected.size === 0) return
    onUpdate({ ...group, children: (group.children ?? []).filter(c => !(c.type === 'row' && selected.has(c.row.id))) })
    setSelected(new Set())
  }

  const rows = rowsOf(group)
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const destinations = buildDestinations(cfg, group.id)

  return (
    <div>
      {/* Header */}
      <div className={`flex items-center gap-1.5 px-3 py-2 ${headerBg}`}>
        <button onClick={() => onUpdate({ ...group, collapsed: !group.collapsed })} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${group.collapsed ? '-rotate-90' : ''}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {editLabel ? (
          <input autoFocus value={labelVal} onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel} onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditLabel(false) }}
            className="text-sm font-bold flex-1 border border-violet-300 rounded px-2 py-0.5 focus:outline-none bg-white" />
        ) : (
          <button onClick={() => { setEditLabel(true); setLabelVal(group.label) }}
            className="text-sm font-bold text-slate-800 hover:text-violet-700 flex-1 text-left truncate">
            {group.label || '(unnamed group)'}
          </button>
        )}

        {/* One-time / Recurring toggle */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {(['one-time', 'recurring'] as ConfigGroupPricingType[]).map(pt => (
            <button key={pt} onClick={() => onUpdate({ ...group, pricingType: pt, children: (group.children ?? []).map(c => c.type === 'subgroup' ? { ...c, group: { ...c.group, pricingType: pt } } : c) })}
              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors capitalize ${
                group.pricingType === pt ? (pt === 'recurring' ? 'bg-indigo-500 text-white' : 'bg-slate-600 text-white') : 'bg-white text-slate-400 hover:text-slate-600 border border-slate-200'
              }`}>
              {pt === 'one-time' ? '1×' : '↻'}
            </button>
          ))}
          {/* Default unit for recurring */}
          {isRecurring && (
            <select value={group.defaultUnit ?? 'months'}
              onChange={e => onUpdate({ ...group, defaultUnit: e.target.value as ConfigRowUnit })}
              className="text-[11px] border border-indigo-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 ml-1">
              {RECURRING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
        </div>

        {/* Disc% → Net → ×Qty → Total */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Disc % */}
          <div className="flex flex-col items-center gap-0">
            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide leading-none mb-0.5">Disc%</span>
            <div className="relative flex items-center">
              <input type="number" min="0" max="100" step="0.1"
                value={groupDiscInput}
                onChange={e => setGroupDiscInput(e.target.value)}
                onBlur={e => applyGroupDisc(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyGroupDisc(groupDiscInput) }}
                placeholder="0"
                className="w-12 border border-slate-200 rounded px-1 py-0.5 text-[11px] text-center pr-3.5 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
              />
              <span className="absolute right-1 text-[9px] text-slate-400 pointer-events-none">%</span>
            </div>
          </div>
          {/* Net (editable — sets disc%) */}
          <div className="flex flex-col items-center gap-0">
            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide leading-none mb-0.5">Net</span>
            <input type="number" min="0" step="0.01"
              defaultValue={dispSubtotal.toFixed(2)}
              key={`${dispSubtotal.toFixed(2)}`}
              onBlur={e => applyGroupNet(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyGroupNet((e.target as HTMLInputElement).value) }}
              placeholder="0.00"
              className="w-20 border border-slate-200 rounded px-1 py-0.5 text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
            />
          </div>
          {/* × */}
          <span className="text-slate-400 text-xs font-bold flex-shrink-0 mt-3">×</span>
          {/* Qty */}
          <div className="flex flex-col items-center gap-0">
            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide leading-none mb-0.5">Qty</span>
            <input type="number" min="1" step="1"
              value={groupQtyInput}
              onChange={e => setGroupQtyInput(e.target.value)}
              onBlur={e => applyGroupQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyGroupQty(groupQtyInput) }}
              placeholder="1"
              className="w-12 border border-slate-200 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
            />
          </div>
          {/* = Total */}
          <div className="flex flex-col items-end gap-0">
            <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wide leading-none mb-0.5">Total</span>
            <span className="text-xs font-bold text-slate-700 whitespace-nowrap">{dispFmt(dispTotal)}</span>
            {showSecondary && <span className="text-[10px] text-slate-400">{secFmt(total)}</span>}
          </div>
        </div>

        {!group.collapsed && (
          <div className="flex gap-1 flex-shrink-0 items-center">
            {selected.size > 0 && (
              <>
                <button onClick={promoteToSubGroup} title="Make selected rows a sub-group (keeps position)"
                  className="text-[11px] text-violet-700 bg-violet-100 hover:bg-violet-200 px-1.5 py-0.5 rounded font-semibold transition-colors whitespace-nowrap">
                  → Sub ({selected.size})
                </button>
                <button onClick={deleteSelected} title="Delete selected rows"
                  className="text-[11px] text-red-600 bg-red-50 hover:bg-red-100 px-1.5 py-0.5 rounded font-semibold transition-colors whitespace-nowrap">
                  Delete ({selected.size})
                </button>
                {destinations.length > 0 && (
                  <select defaultValue="" onChange={e => { if (e.target.value) { onMoveRows(selected, e.target.value); setSelected(new Set()) } }}
                    className="text-[11px] border border-slate-300 rounded px-1 py-0.5 bg-white focus:outline-none max-w-[110px]">
                    <option value="">Move to…</option>
                    {destinations.map(d => (
                      <option key={d.id} value={d.id}>{d.indent ? '  › ' : ''}{d.label}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            <button onClick={addRow} className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Row</button>
            <button onClick={addSubGroup} className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Sub</button>
          </div>
        )}

        <div className="flex flex-col gap-0 flex-shrink-0">
          <button onClick={() => onMoveGroup(groupIndex, groupIndex - 1)} disabled={groupIndex === 0} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none p-0.5">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 7l3-4 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={() => onMoveGroup(groupIndex, groupIndex + 1)} disabled={groupIndex === totalGroups - 1} className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none p-0.5">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <button onClick={onDelete} className="text-slate-300 hover:text-red-500 flex-shrink-0 p-1 rounded transition-colors">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {!group.collapsed && (group.children ?? []).length > 0 && (
        <div>
          {(group.children ?? []).map((child, ci) => {
            if (child.type === 'row') {
              return (
                <ConfigRowEditor
                  key={child.row.id} row={child.row} isRecurring={isRecurring}
                  groupDefaultUnit={group.defaultUnit ?? 'months'}
                  inputIsAud={inputIsAud}
                  onChange={r => updateChild(ci, { type: 'row', row: r })}
                  onDelete={() => deleteChild(ci)}
                  selected={selected.has(child.row.id)} onToggleSelect={() => toggleSelect(child.row.id)}
                  onDragStart={() => { dragFrom.current = ci }}
                  onDrop={() => { if (dragFrom.current !== null && dragFrom.current !== ci) reorderChildren(dragFrom.current, ci); dragFrom.current = null }}
                  fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                  colWidths={colWidths} hiddenCols={hiddenCols}
                />
              )
            }
            // subgroup child
            return (
              <SubGroupBlock
                key={child.group.id}
                subGroup={child.group}
                childIndex={ci}
                totalChildren={group.children.length}
                cfg={cfg}
                inputIsAud={inputIsAud}
                parentIsRecurring={isRecurring}
                parentDefaultUnit={group.defaultUnit ?? 'months'}
                onUpdate={sg => updateChild(ci, { type: 'subgroup', group: sg })}
                onDelete={() => deleteChild(ci)}
                onMoveRowsToParent={(rowChildren) => {
                  const rowIds = new Set(rowChildren.filter(c => c.type === 'row').map(c => (c as {type:'row';row:ConfigRow}).row.id))
                  const updatedSg = { ...child.group, children: (child.group.children ?? []).filter(c => !(c.type === 'row' && rowIds.has(c.row.id))) }
                  const groupChildren = group.children ?? []
                  const nextChildren: typeof groupChildren = []
                  for (let i = 0; i < groupChildren.length; i++) {
                    if (i === ci) { nextChildren.push(...rowChildren); nextChildren.push({ type: 'subgroup', group: updatedSg }) }
                    else nextChildren.push(groupChildren[i])
                  }
                  onUpdate({ ...group, children: nextChildren })
                }}
                onDragStart={() => { dragFrom.current = ci }}
                onDrop={() => { if (dragFrom.current !== null && dragFrom.current !== ci) reorderChildren(dragFrom.current, ci); dragFrom.current = null }}
                onDropRowsInto={(insertAt) => {
                  // Move dragged rows (selected or single) from parent group into this subgroup at insertAt
                  const fromIdx = dragFrom.current
                  if (fromIdx === null || fromIdx === ci) { dragFrom.current = null; return }
                  const groupChildren2 = group.children ?? []
                  const dragged = groupChildren2[fromIdx]
                  if (!dragged || dragged.type !== 'row') { dragFrom.current = null; return }
                  // Collect all rows to move: multi if selected, single otherwise
                  const isMulti = selected.has(dragged.row.id) && selected.size > 1
                  const toMove = isMulti
                    ? groupChildren2.filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id))
                    : [dragged]
                  const toMoveIds = new Set(toMove.map(c => (c as {type:'row';row:ConfigRow}).row.id))
                  const parentRest = groupChildren2.filter(c => !(c.type === 'row' && toMoveIds.has((c as {type:'row';row:ConfigRow}).row.id)))
                  const sgChildren = child.group.children ?? []
                  const newSgChildren = [...sgChildren.slice(0, insertAt), ...toMove, ...sgChildren.slice(insertAt)]
                  const updatedSg2 = { ...child.group, children: newSgChildren }
                  const nextChildren2 = parentRest.map(c => c.type === 'subgroup' && c.group.id === child.group.id ? { type: 'subgroup' as const, group: updatedSg2 } : c)
                  onUpdate({ ...group, children: nextChildren2 })
                  dragFrom.current = null
                }}
                fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                colWidths={colWidths} onColResize={onColResize} hiddenCols={hiddenCols}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Sub-group ────────────────────────────────────────────────────────────────

// Preset palette for sub-group highlight colours
const SUB_GROUP_PALETTE = [
  '#fef9c3', // yellow-100
  '#fde68a', // amber-200
  '#fed7aa', // orange-200
  '#fecaca', // red-200
  '#fbcfe8', // pink-200
  '#e9d5ff', // violet-200
  '#bfdbfe', // blue-200
  '#a7f3d0', // emerald-200
  '#bbf7d0', // green-200
  '#e0f2fe', // sky-100
  '#f1f5f9', // slate-100
  '#ffffff', // white
]

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null
}

// Returns a slightly darkened version of the colour for the header bar
function darkenHex(hex: string, amount = 15): string {
  const c = hexToRgb(hex)
  if (!c) return hex
  const clamp = (v: number) => Math.max(0, Math.min(255, v))
  return `rgb(${clamp(c.r - amount)},${clamp(c.g - amount)},${clamp(c.b - amount)})`
}

function SubGroupBlock({
  subGroup, childIndex: _childIndex, totalChildren: _totalChildren, cfg: _cfg, inputIsAud,
  parentIsRecurring, parentDefaultUnit,
  onUpdate, onDelete, onMoveRowsToParent, onDragStart, onDrop, onDropRowsInto,
  fmt, fmtAud, showSecondary, usdToAudRate, colWidths, onColResize: _onColResize, hiddenCols,
}: {
  subGroup: ConfigGroup; childIndex: number; totalChildren: number; cfg: ProductConfiguration
  inputIsAud: boolean
  parentIsRecurring: boolean; parentDefaultUnit: ConfigRowUnit
  onUpdate: (g: ConfigGroup) => void; onDelete: () => void
  onMoveRowsToParent: (rowChildren: ConfigChild[]) => void
  onDragStart: () => void; onDrop: () => void
  onDropRowsInto: (insertAt: number) => void  // drop row(s) from parent into this subgroup at position
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
  colWidths: ColWidths; onColResize: (idx: number, delta: number) => void; hiddenCols: Set<number>
}) {
  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(subGroup.label)
  const [editDesc, setEditDesc] = useState(false)
  const [descVal, setDescVal] = useState(subGroup.description ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const [headerDragOver, setHeaderDragOver] = useState(false)
  const [subDiscInput, setSubDiscInput] = useState(() => (subGroup.discountPct ?? 0).toFixed(1))
  const [subQtyInput, setSubQtyInput] = useState(() => String(subGroup.qty ?? 1))
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [subGroupSelected, setSubGroupSelected] = useState(false)
  const dragFrom = useRef<number | null>(null)
  // dropZoneOver: which inter-row gap is being hovered during a drag-from-parent
  const [dropZoneOver, setDropZoneOver] = useState<number | null>(null)

  const isRecurring = parentIsRecurring
  const subtotal     = groupSubtotal(subGroup)
  const total        = subtotal * (subGroup.qty ?? 1)
  const dispSubtotal = inputIsAud ? subtotal * usdToAudRate : subtotal
  const dispTotal    = inputIsAud ? total * usdToAudRate : total
  const dispFmt  = inputIsAud ? fmtAud : fmt
  const secFmt   = inputIsAud ? fmt : fmtAud
  const effectiveDefaultUnit = subGroup.defaultUnit ?? parentDefaultUnit

  // Colour theming
  const accentColor   = subGroup.color ?? '#fef9c3'
  const headerBgStyle = { backgroundColor: darkenHex(accentColor, 12) }
  const childBgStyle  = { backgroundColor: accentColor }
  const borderStyle   = { borderLeftColor: darkenHex(accentColor, 40), borderLeftWidth: 3, borderLeftStyle: 'solid' as const }

  function commitLabel() { onUpdate({ ...subGroup, label: labelVal.trim() || subGroup.label }); setEditLabel(false) }
  function commitDesc()  { onUpdate({ ...subGroup, description: descVal.trim() || undefined }); setEditDesc(false) }
  function addRow() { onUpdate({ ...subGroup, children: [...(subGroup.children ?? []), { type: 'row', row: emptyRow() }] }) }

  function applySubDisc(val: string) {
    const d = parseFloat(val)
    if (!isNaN(d)) {
      const clamped = Math.max(0, Math.min(100, d))
      onUpdate(applyGroupDiscount(subGroup, clamped))
      setSubDiscInput(clamped.toFixed(1))
    } else {
      setSubDiscInput((subGroup.discountPct ?? 0).toFixed(1))
    }
  }

  function applySubNet(val: string) {
    const net = parseFloat(val)
    const toUsd = (v: number) => inputIsAud ? v / usdToAudRate : v
    const netUsd = toUsd(net)
    const sellSub = (() => { const gg = applyGroupDiscount(subGroup, 0); return groupSubtotal(gg) })()
    if (!isNaN(net) && sellSub > 0) {
      const newDisc = Math.max(0, Math.min(100, (1 - netUsd / sellSub) * 100))
      onUpdate(applyGroupDiscount(subGroup, newDisc))
      setSubDiscInput(newDisc.toFixed(1))
    }
  }

  function applySubQty(val: string) {
    const q = parseInt(val)
    if (!isNaN(q) && q > 0) { onUpdate({ ...subGroup, qty: q }); setSubQtyInput(String(q)) }
    else setSubQtyInput(String(subGroup.qty ?? 1))
  }

  function updateChild(idx: number, child: ConfigChild) {
    const next = [...(subGroup.children ?? [])]; next[idx] = child
    onUpdate({ ...subGroup, children: next })
  }
  function deleteChild(idx: number) {
    onUpdate({ ...subGroup, children: (subGroup.children ?? []).filter((_, i) => i !== idx) })
  }
  function reorderChildren(from: number, to: number) {
    const children = subGroup.children ?? []
    const draggingSelected = children[from]?.type === 'row' && selected.has((children[from] as {type:'row';row:ConfigRow}).row.id)
    if (draggingSelected && selected.size > 1) {
      const moving = children.filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id))
      const rest   = children.filter(c => !(c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)))
      const beforeTo = children.slice(0, to).filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)).length
      const insertAt = Math.min(Math.max(0, to - beforeTo), rest.length)
      onUpdate({ ...subGroup, children: [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)] })
    } else {
      onUpdate({ ...subGroup, children: reorder(children, from, to) })
    }
  }
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const subGroupRows = (subGroup.children ?? []).filter(c => c.type === 'row').map(c => (c as {type:'row';row:ConfigRow}).row.id)
  function toggleSubGroup(checked: boolean) {
    setSubGroupSelected(checked)
    if (checked) setSelected(new Set(subGroupRows))
    else setSelected(new Set())
  }

  return (
    <div
      draggable onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop() }}
      className={dragOver ? 'border-t-2 border-blue-400' : ''}
    >
      {/* Sub-group header row — acts as the "product" row */}
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(true) }}
        onDragLeave={e => { e.stopPropagation(); setHeaderDragOver(false) }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(false); onDropRowsInto(0) }}
        style={{ ...headerBgStyle, ...(headerDragOver ? {} : {}) }}
        className={`flex items-center gap-1.5 px-2 py-1.5 border-t border-black/10 ${headerDragOver ? 'ring-2 ring-inset ring-blue-400' : ''}`}
      >
        {/* Subgroup checkbox */}
        <input type="checkbox" checked={subGroupSelected} onChange={e => toggleSubGroup(e.target.checked)}
          className="w-3 h-3 cursor-pointer flex-shrink-0" title="Select all rows in this sub-group" />

        {/* Colour picker swatch — visible when subgroup is selected */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowColorPicker(v => !v)}
            style={{ backgroundColor: accentColor, borderColor: darkenHex(accentColor, 40) }}
            className="w-4 h-4 rounded-sm border cursor-pointer flex-shrink-0"
            title="Choose highlight colour"
          />
          {showColorPicker && (
            <div
              className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 grid grid-cols-6 gap-1"
              onMouseLeave={() => setShowColorPicker(false)}
            >
              {SUB_GROUP_PALETTE.map(c => (
                <button
                  key={c}
                  onClick={() => { onUpdate({ ...subGroup, color: c }); setShowColorPicker(false) }}
                  style={{ backgroundColor: c, borderColor: darkenHex(c, 40) }}
                  className={`w-5 h-5 rounded border hover:scale-110 transition-transform ${accentColor === c ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button onClick={() => onUpdate({ ...subGroup, collapsed: !subGroup.collapsed })} className="text-slate-500 hover:text-slate-700 flex-shrink-0">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className={`transition-transform ${subGroup.collapsed ? '-rotate-90' : ''}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Drag handle */}
        <span className="cursor-grab text-slate-400 hover:text-slate-600 select-none text-xs flex-shrink-0" title="Drag to reorder">⠿</span>

        {/* Code (label) */}
        <div className="flex-shrink-0" style={{ width: colWidths[0] }}>
          {editLabel ? (
            <input autoFocus value={labelVal} onChange={e => setLabelVal(e.target.value)}
              onBlur={commitLabel} onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditLabel(false) }}
              className="w-full text-xs font-semibold border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none bg-white font-mono" />
          ) : (
            <button onClick={() => { setEditLabel(true); setLabelVal(subGroup.label) }}
              className="w-full text-xs font-bold text-slate-800 hover:text-blue-700 text-left truncate font-mono">
              {subGroup.label || '(code)'}
            </button>
          )}
        </div>

        {/* Description */}
        <div className="flex-1 min-w-0">
          {editDesc ? (
            <input autoFocus value={descVal} onChange={e => setDescVal(e.target.value)}
              onBlur={commitDesc} onKeyDown={e => { if (e.key === 'Enter') commitDesc(); if (e.key === 'Escape') setEditDesc(false) }}
              className="w-full text-xs border border-blue-300 rounded px-1.5 py-0.5 focus:outline-none bg-white" />
          ) : (
            <button onClick={() => { setEditDesc(true); setDescVal(subGroup.description ?? '') }}
              className="w-full text-xs text-slate-700 hover:text-blue-700 text-left truncate italic">
              {subGroup.description || <span className="text-slate-400 not-italic">Description…</span>}
            </button>
          )}
        </div>

        {/* Recurring unit */}
        {isRecurring && (
          <select value={effectiveDefaultUnit}
            onChange={e => onUpdate({ ...subGroup, defaultUnit: e.target.value as ConfigRowUnit })}
            className="text-[11px] border border-indigo-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-shrink-0">
            {RECURRING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}

        {/* Disc% → Net → ×Qty → Total */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide leading-none mb-0.5">Disc%</span>
            <div className="relative flex items-center">
              <input type="number" min="0" max="100" step="0.1"
                value={subDiscInput}
                onChange={e => setSubDiscInput(e.target.value)}
                onBlur={e => applySubDisc(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applySubDisc(subDiscInput) }}
                placeholder="0"
                className="w-12 bg-white/70 border border-black/15 rounded px-1 py-0.5 text-[11px] text-center pr-3.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <span className="absolute right-1 text-[9px] text-slate-500 pointer-events-none">%</span>
            </div>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide leading-none mb-0.5">Net</span>
            <input type="number" min="0" step="0.01"
              defaultValue={dispSubtotal.toFixed(2)}
              key={`${dispSubtotal.toFixed(2)}`}
              onBlur={e => applySubNet(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applySubNet((e.target as HTMLInputElement).value) }}
              placeholder="0.00"
              className="w-20 bg-white/70 border border-black/15 rounded px-1 py-0.5 text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <span className="text-slate-500 text-xs font-bold flex-shrink-0 mt-3">×</span>
          <div className="flex flex-col items-center">
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide leading-none mb-0.5">Qty</span>
            <input type="number" min="1" step="1"
              value={subQtyInput}
              onChange={e => setSubQtyInput(e.target.value)}
              onBlur={e => applySubQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applySubQty(subQtyInput) }}
              placeholder="1"
              className="w-12 bg-white/70 border border-black/15 rounded px-1 py-0.5 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide leading-none mb-0.5">Total</span>
            <span className="text-xs font-bold text-slate-800 whitespace-nowrap">{dispFmt(dispTotal)}</span>
            {showSecondary && <span className="text-[10px] text-slate-500">{secFmt(total)}</span>}
          </div>
        </div>

        {/* Actions */}
        {!subGroup.collapsed && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {selected.size > 0 && (
              <button
                onClick={() => { const toMove = subGroup.children.filter(c => c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)); onMoveRowsToParent(toMove); setSelected(new Set()) }}
                className="text-[11px] text-amber-700 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded font-semibold transition-colors whitespace-nowrap">
                ↑ Parent ({selected.size})
              </button>
            )}
            <button onClick={addRow} className="text-[11px] text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white/50 transition-colors">+Row</button>
          </div>
        )}

        <button onClick={onDelete} className="text-slate-400 hover:text-red-500 flex-shrink-0 p-1 rounded transition-colors">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Component rows — tinted with the subgroup colour */}
      {!subGroup.collapsed && (subGroup.children ?? []).length > 0 && (
        <div>
          {(subGroup.children ?? []).map((child, ci) => {
            if (child.type !== 'row') return null
            return (
              <React.Fragment key={child.row.id}>
                {/* Drop zone above this row (from parent group drag) */}
                <div
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropZoneOver(ci) }}
                  onDragLeave={() => setDropZoneOver(null)}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); setDropZoneOver(null); onDropRowsInto(ci) }}
                  className={`h-1 transition-colors ${dropZoneOver === ci ? 'bg-blue-400' : 'hover:bg-blue-200'}`}
                />
                <ConfigRowEditor
                  row={child.row} isRecurring={isRecurring}
                  groupDefaultUnit={effectiveDefaultUnit}
                  inputIsAud={inputIsAud}
                  onChange={r => updateChild(ci, { type: 'row', row: r })}
                  onDelete={() => deleteChild(ci)}
                  selected={selected.has(child.row.id)} onToggleSelect={() => toggleSelect(child.row.id)}
                  onDragStart={() => { dragFrom.current = ci }}
                  onDrop={() => { if (dragFrom.current !== null && dragFrom.current !== ci) reorderChildren(dragFrom.current, ci); dragFrom.current = null }}
                  fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                  colWidths={colWidths} hiddenCols={hiddenCols}
                  rowBgStyle={childBgStyle} rowBorderStyle={borderStyle}
                />
              </React.Fragment>
            )
          })}
          {/* Drop zone at the end of the subgroup */}
          <div
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropZoneOver(subGroup.children?.length ?? 0) }}
            onDragLeave={() => setDropZoneOver(null)}
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setDropZoneOver(null); onDropRowsInto(subGroup.children?.length ?? 0) }}
            className={`h-2 transition-colors ${dropZoneOver === (subGroup.children?.length ?? 0) ? 'bg-blue-400' : ''}`}
          />
        </div>
      )}
    </div>
  )
}

// ─── Table header ─────────────────────────────────────────────────────────────

function ConfigTableHeader({
  isRecurring, showSelect = false, onSelectAll, allSelected, colWidths, onColResize, hiddenCols,
}: {
  isRecurring: boolean; showSelect?: boolean
  onSelectAll?: () => void; allSelected?: boolean
  colWidths: ColWidths; onColResize: (idx: number, delta: number) => void; hiddenCols: Set<number>
}) {
  const cols = buildColTemplate(colWidths, isRecurring, hiddenCols)
  // Header labels with their colWidths index for resize
  const headers: { label: string; align: string; wIdx: number }[] = [
    { label: 'Code',  align: '',               wIdx: 0 },
    { label: 'Description', align: '',         wIdx: 1 },
    { label: 'Qty',   align: 'text-center',    wIdx: 2 },
    { label: 'Cost',  align: 'text-right pr-1',wIdx: 3 },
    { label: 'Floor', align: 'text-right pr-1',wIdx: 4 },
    { label: 'Sell',  align: 'text-right pr-1',wIdx: 5 },
    ...(isRecurring ? [
      { label: 'Unit', align: 'text-center',   wIdx: 6 },
      { label: 'Term', align: 'text-center',   wIdx: 7 },
    ] : []),
    { label: 'Disc%', align: 'text-center',    wIdx: 9 },
    { label: 'Net',   align: 'text-right pr-1',wIdx: 10 },
    { label: 'Total', align: 'text-right pr-1',wIdx: 8 },
  ]
  return (
    <div className="grid gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 border-t border-b border-slate-100 py-1 pl-2"
      style={{ gridTemplateColumns: cols }}>
      <span className="flex items-center">
        {showSelect && <input type="checkbox" checked={!!allSelected} onChange={onSelectAll} className="w-3 h-3 cursor-pointer" />}
      </span>
      <span />
      {headers.map(h => (
        hiddenCols.has(h.wIdx)
          ? <span key={h.label} className="overflow-hidden" />
          : <span key={h.label} className={`relative ${h.align}`}>
              {h.label}
              <ColResizeHandle onResize={d => onColResize(h.wIdx, d)} />
            </span>
      ))}
      <span />
    </div>
  )
}

// ─── Row editor ───────────────────────────────────────────────────────────────

function ConfigRowEditor({
  row, isRecurring, groupDefaultUnit, inputIsAud, onChange, onDelete, selected, onToggleSelect,
  onDragStart, onDrop,
  fmt, fmtAud, showSecondary, usdToAudRate, colWidths, hiddenCols,
  rowBgStyle, rowBorderStyle,
}: {
  row: ConfigRow; isRecurring: boolean; groupDefaultUnit: ConfigRowUnit; inputIsAud: boolean
  onChange: (r: ConfigRow) => void; onDelete: () => void
  selected: boolean; onToggleSelect: () => void
  onDragStart: () => void; onDrop: () => void
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
  colWidths: ColWidths; hiddenCols: Set<number>
  rowBgStyle?: React.CSSProperties
  rowBorderStyle?: React.CSSProperties
}) {
  const [dragOver, setDragOver] = useState(false)
  const rate = usdToAudRate
  const toDisplay = (usd: number) => inputIsAud ? usd * rate : usd
  const toUsd = (v: number) => inputIsAud ? v / rate : v

  const dispCost  = toDisplay(row.costPriceUsd)
  const dispFloor = toDisplay(row.floorPriceUsd)
  const dispSell  = toDisplay(row.sellPriceUsd)
  const discPct   = row.discountPct ?? 0
  const dispNet   = dispSell * (1 - discPct / 100)
  // Total = net displayed price × qty × term
  const dispTotal = dispNet * (row.quantity ?? 1) * (isRecurring ? (row.termMonths ?? 1) : 1)
  const totalNetUsd = rowNetUsd(row) * (row.quantity ?? 1) * (isRecurring ? (row.termMonths ?? 1) : 1)
  const dispFmt   = inputIsAud ? fmtAud : fmt
  const secFmt    = inputIsAud ? fmt : fmtAud
  const belowFloor = row.floorPriceUsd > 0 && row.sellPriceUsd < row.floorPriceUsd

  const [discInput, setDiscInput] = useState(() => discPct.toFixed(1))
  const [netInput, setNetInput] = useState(() => dispNet.toFixed(2))

  // Keep inputs in sync when row changes externally
  const prevDisc = useRef(row.discountPct)
  const prevSell = useRef(row.sellPriceUsd)
  if (prevDisc.current !== row.discountPct || prevSell.current !== row.sellPriceUsd) {
    prevDisc.current = row.discountPct
    prevSell.current = row.sellPriceUsd
    setDiscInput((row.discountPct ?? 0).toFixed(1))
    setNetInput((toDisplay(row.sellPriceUsd) * (1 - (row.discountPct ?? 0) / 100)).toFixed(2))
  }

  function applyDiscount(val: string) {
    const d = parseFloat(val)
    if (!isNaN(d)) {
      const clamped = Math.max(0, Math.min(100, d))
      setField('discountPct', clamped)
      setDiscInput(clamped.toFixed(1))
      setNetInput((dispSell * (1 - clamped / 100)).toFixed(2))
    } else {
      setDiscInput(discPct.toFixed(1))
    }
  }

  function applyNet(val: string) {
    const n = parseFloat(val)
    if (!isNaN(n) && dispSell > 0) {
      const newDisc = Math.max(0, Math.min(100, (1 - n / dispSell) * 100))
      setField('discountPct', newDisc)
      setDiscInput(newDisc.toFixed(1))
      setNetInput((dispSell * (1 - newDisc / 100)).toFixed(2))
    } else {
      setNetInput(dispNet.toFixed(2))
    }
  }

  function setField<K extends keyof ConfigRow>(k: K, v: ConfigRow[K]) { onChange({ ...row, [k]: v }) }

  const iCls = "w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"

  const cols = buildColTemplate(colWidths, isRecurring, hiddenCols)

  return (
    <div
      draggable onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop() }}
      className={`grid items-center gap-1 py-0.5 border-b border-black/5 last:border-0 transition-colors
        ${selected ? 'bg-blue-50' : ''}
        ${dragOver ? 'border-t-2 border-blue-400' : ''}
      `}
      style={{ gridTemplateColumns: cols, paddingLeft: '8px', ...rowBorderStyle }}
    >
      <div style={selected ? undefined : rowBgStyle} className="flex items-center justify-center rounded-sm">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="w-3 h-3 cursor-pointer" />
      </div>
      <span className="cursor-grab text-slate-300 hover:text-slate-500 select-none text-center text-xs" title="Drag to reorder">⠿</span>
      <div className={hiddenCols.has(0) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(0) && <input value={row.productCode ?? ''} onChange={e => setField('productCode', e.target.value || undefined)}
          placeholder="Code…" className={`${iCls} font-mono text-[11px] text-slate-500`} />}
      </div>
      <div className={hiddenCols.has(1) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(1) && <input value={row.description} onChange={e => setField('description', e.target.value)}
          placeholder="Description…" className={iCls} />}
      </div>
      <div className={hiddenCols.has(2) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(2) && <input type="number" min="0" step="1" value={row.quantity || ''}
          onChange={e => setField('quantity', parseInt(e.target.value) || 0)}
          className={`${iCls} text-right`} />}
      </div>
      <div className={hiddenCols.has(3) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(3) && <input type="number" min="0" step="0.01"
          value={dispCost === 0 ? '' : dispCost.toFixed(2)}
          onChange={e => setField('costPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
          placeholder="0.00" className={`${iCls} text-right`} />}
      </div>
      <div className={hiddenCols.has(4) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(4) && <input type="number" min="0" step="0.01"
          value={dispFloor === 0 ? '' : dispFloor.toFixed(2)}
          onChange={e => setField('floorPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
          placeholder="0.00" className={`${iCls} text-right`} />}
      </div>
      <div className={hiddenCols.has(5) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(5) && <input type="number" min="0" step="0.01"
          value={dispSell === 0 ? '' : dispSell.toFixed(2)}
          onChange={e => setField('sellPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
          placeholder="0.00" className={`${iCls} text-right ${belowFloor ? 'border-red-300 bg-red-50' : ''}`} />}
      </div>
      {isRecurring && (
        <div className={hiddenCols.has(6) ? 'overflow-hidden' : ''}>
          {!hiddenCols.has(6) && <select value={row.unit ?? groupDefaultUnit}
            onChange={e => setField('unit', e.target.value as ConfigRowUnit)}
            className="w-full border border-slate-200 rounded px-0.5 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
            {RECURRING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>}
        </div>
      )}
      {isRecurring && (
        <div className={hiddenCols.has(7) ? 'overflow-hidden' : ''}>
          {!hiddenCols.has(7) && <input type="number" min="0" step="1"
            value={row.termMonths ?? ''}
            onChange={e => setField('termMonths', parseInt(e.target.value) || undefined)}
            placeholder="—" className={`${iCls} text-center`} />}
        </div>
      )}
      <div className={hiddenCols.has(9) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(9) && (
          <div className="relative flex items-center">
            <input
              type="number" min="0" max="100" step="0.1"
              value={discInput}
              onChange={e => setDiscInput(e.target.value)}
              onBlur={e => applyDiscount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyDiscount(discInput) }}
              placeholder="0.0"
              className={`${iCls} text-center pr-4`}
            />
            <span className="absolute right-1.5 text-[10px] text-slate-400 pointer-events-none">%</span>
          </div>
        )}
      </div>
      <div className={hiddenCols.has(10) ? 'overflow-hidden' : ''}>
        {!hiddenCols.has(10) && (
          <input
            type="number" min="0" step="0.01"
            value={netInput}
            onChange={e => setNetInput(e.target.value)}
            onBlur={e => applyNet(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyNet(netInput) }}
            placeholder="0.00"
            className={`${iCls} text-right`}
          />
        )}
      </div>
      <div className={`text-right pr-1 ${hiddenCols.has(8) ? 'overflow-hidden' : ''}`}>
        {!hiddenCols.has(8) && <>
          <p className="text-xs font-semibold text-slate-700">{dispFmt(dispTotal)}</p>
          {showSecondary && totalNetUsd > 0 && <p className="text-[10px] text-slate-400">{secFmt(totalNetUsd)}</p>}
        </>}
      </div>
      <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

// ─── Footer totals ────────────────────────────────────────────────────────────

function ConfigTotalsFooter({ config, inputIsAud, fmt, fmtAud, showSecondary, usdToAudRate }: {
  config: ProductConfiguration; inputIsAud: boolean; fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const totalUsd = (config.groups ?? []).reduce((s, g) => s + groupTotal(g), 0)
  const dispFmt  = inputIsAud ? fmtAud : fmt
  const secFmt   = inputIsAud ? fmt : fmtAud
  const dispTotal = inputIsAud ? totalUsd * usdToAudRate : totalUsd
  return (
    <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-4">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Configuration Total</span>
      <div className="text-right">
        <p className="text-base font-bold text-slate-900">{dispFmt(dispTotal)}</p>
        {showSecondary && <p className="text-xs text-slate-400">{secFmt(totalUsd)}</p>}
      </div>
    </div>
  )
}
