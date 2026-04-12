import { useState, useCallback, useRef } from 'react'
import { uid } from '../../lib/utils'
import { useCurrency } from '../../store/useCurrency'
import type {
  ProductConfiguration, ConfigGroup, ConfigRow, ConfigRowUnit,
} from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const UNITS: ConfigRowUnit[] = ['one time', 'months', 'years', 'per unit', 'per site', 'per user']

function emptyRow(): ConfigRow {
  return { id: uid(), description: '', quantity: 1, costPriceUsd: 0, floorPriceUsd: 0, sellPriceUsd: 0, unit: 'one time' }
}

function emptyGroup(label = ''): ConfigGroup {
  return { id: uid(), label, description: '', collapsed: false, unit: 'one time', rows: [], subGroups: [] }
}

function emptyConfig(): ProductConfiguration {
  const g = emptyGroup('Group 1')
  g.rows = [emptyRow()]
  return { id: uid(), name: 'New Configuration', currency: 'USD', groups: [g], createdAt: Date.now(), updatedAt: Date.now() }
}

// ─── Totals ───────────────────────────────────────────────────────────────────

function rowTotal(row: ConfigRow): number {
  return row.sellPriceUsd * row.quantity * (row.termMonths ?? 1)
}

function groupTotal(g: ConfigGroup): number {
  return g.rows.reduce((s, r) => s + rowTotal(r), 0)
    + g.subGroups.reduce((s, sg) => s + groupTotal(sg), 0)
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
    const desc = iDesc >= 0 ? c[iDesc] ?? '' : ''
    const code = iPCode >= 0 ? c[iPCode] ?? '' : ''
    const qty  = iQty >= 0 ? parseFloat(c[iQty] ?? '1') || 1 : 1
    const cost = iCost >= 0 ? toUsd(c[iCost] ?? '0') : 0
    const floor = iFloor >= 0 ? toUsd(c[iFloor] ?? '0') : 0
    const sell = iSell >= 0 ? toUsd(c[iSell] ?? '0') : 0
    const rawUnit = (iUnit >= 0 ? c[iUnit] ?? '' : '').toLowerCase()
    const unit: ConfigRowUnit = UNITS.find(u => u === rawUnit) ?? 'one time'
    const term = iTerm >= 0 ? parseInt(c[iTerm] ?? '1') || undefined : undefined
    const isHeader = code === '' && desc !== '' && cost === 0 && floor === 0 && sell === 0
    if (isHeader) {
      if (!curTop) { curTop = { ...emptyGroup(desc), rows: [] }; curSub = null; groups.push(curTop) }
      else { curSub = { ...emptyGroup(desc), rows: [] }; curTop.subGroups.push(curSub) }
      continue
    }
    if (!desc && !code) continue
    const row: ConfigRow = { id: uid(), productCode: code || undefined, description: desc, quantity: qty, costPriceUsd: cost, floorPriceUsd: floor, sellPriceUsd: sell, unit, termMonths: term }
    const target = curSub ?? curTop
    if (target) target.rows.push(row)
    else { curTop = { ...emptyGroup('Group 1'), rows: [row] }; groups.push(curTop) }
  }
  return groups.length > 0 ? { groups } : null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  configs: ProductConfiguration[]
  onChange: (configs: ProductConfiguration[]) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProductConfigEditor({ configs, onChange }: Props) {
  const [activeConfigId, setActiveConfigId] = useState<string | null>(configs[0]?.id ?? null)
  const [editingConfigName, setEditingConfigName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const pasteAreaRef = useRef<HTMLTextAreaElement>(null)

  const usdToAudRate  = useCurrency(s => s.usdToAudRate)
  const fmt           = useCurrency(s => s.fmt)
  const fmtAud        = useCurrency(s => s.fmtAud)
  const showSecondary = useCurrency(s => s.showSecondary)

  const activeConfig = configs.find(c => c.id === activeConfigId) ?? null

  const updateConfig = useCallback((updated: ProductConfiguration) => {
    onChange(configs.map(c => c.id === updated.id ? { ...updated, updatedAt: Date.now() } : c))
  }, [configs, onChange])

  const addConfig = () => { const c = emptyConfig(); onChange([...configs, c]); setActiveConfigId(c.id) }
  const deleteConfig = (id: string) => { const next = configs.filter(c => c.id !== id); onChange(next); if (activeConfigId === id) setActiveConfigId(next[0]?.id ?? null) }

  function addTopGroup(cfg: ProductConfiguration) {
    const g = emptyGroup(`Group ${cfg.groups.length + 1}`)
    updateConfig({ ...cfg, groups: [...cfg.groups, g] })
  }

  function updateTopGroup(cfg: ProductConfiguration, updated: ConfigGroup) {
    updateConfig({ ...cfg, groups: cfg.groups.map(g => g.id === updated.id ? updated : g) })
  }

  function deleteTopGroup(cfg: ProductConfiguration, groupId: string) {
    updateConfig({ ...cfg, groups: cfg.groups.filter(g => g.id !== groupId) })
  }

  function reorderTopGroups(cfg: ProductConfiguration, from: number, to: number) {
    updateConfig({ ...cfg, groups: reorder(cfg.groups, from, to) })
  }

  function applyPaste(cfg: ProductConfiguration) {
    const result = parseExcelPaste(pasteText, usdToAudRate, cfg.currency === 'AUD')
    if (!result) { setPasteError('Could not parse. Ensure the first row is a header with at least a "Description" column.'); return }
    updateConfig({ ...cfg, groups: result.groups })
    setPasteOpen(false); setPasteText(''); setPasteError('')
  }

  if (configs.length === 0 && !activeConfig) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Configurations</p>
          <button onClick={addConfig} className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors">+ New Config</button>
        </div>
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          No configurations yet. Click <strong>+ New Config</strong> to create one or paste from Excel.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Config tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex-shrink-0">Configurations</p>
        <div className="flex gap-1 flex-wrap flex-1">
          {configs.map(c => (
            <button key={c.id} onClick={() => setActiveConfigId(c.id)}
              className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors border ${activeConfigId === c.id ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}>
              {c.name}
            </button>
          ))}
        </div>
        <button onClick={addConfig} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition-colors flex-shrink-0">+ Add</button>
      </div>

      {activeConfig && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[11px] text-slate-400 font-semibold">Prices in:</span>
              {(['USD', 'AUD'] as const).map(c => (
                <button key={c} onClick={() => updateConfig({ ...activeConfig, currency: c })}
                  className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-colors ${activeConfig.currency === c ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}>{c}</button>
              ))}
            </div>
            <button onClick={() => setPasteOpen(v => !v)}
              className={`text-[11px] px-2 py-1 rounded-lg font-semibold border transition-colors ${pasteOpen ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              Paste Excel
            </button>
            <button onClick={() => addTopGroup(activeConfig)}
              className="text-[11px] px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:border-slate-300 font-semibold transition-colors">
              + Group
            </button>
            <button onClick={() => { if (confirm(`Delete "${activeConfig.name}"?`)) deleteConfig(activeConfig.id) }}
              className="text-[11px] px-2 py-1 rounded-lg bg-white border border-red-200 text-red-500 hover:bg-red-50 font-semibold transition-colors">
              Delete
            </button>
          </div>

          {/* Paste area */}
          {pasteOpen && (
            <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 flex flex-col gap-2">
              <p className="text-xs text-amber-700 font-semibold">
                Paste your Excel table below. First row must be headers including at least <em>Description</em>.
                Optional: ProductID, Quantity, Cost Price, Floor Price, Sell Price, Unit, Term.
                Rows with no ProductID and no prices are treated as group/sub-group headers.
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
            <div className="divide-y divide-slate-100">
              {activeConfig.groups.map((group, gi) => (
                <TopGroupBlock
                  key={group.id}
                  group={group}
                  groupIndex={gi}
                  totalGroups={activeConfig.groups.length}
                  cfg={activeConfig}
                  onUpdate={g => updateTopGroup(activeConfig, g)}
                  onDelete={() => deleteTopGroup(activeConfig, group.id)}
                  onMoveGroup={(from, to) => reorderTopGroups(activeConfig, from, to)}
                  fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                />
              ))}
            </div>
          )}

          <ConfigTotalsFooter config={activeConfig} fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate} />
        </div>
      )}
    </div>
  )
}

// ─── Top-level group ──────────────────────────────────────────────────────────

function TopGroupBlock({
  group, groupIndex, totalGroups, cfg, onUpdate, onDelete, onMoveGroup,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  group: ConfigGroup; groupIndex: number; totalGroups: number; cfg: ProductConfiguration
  onUpdate: (g: ConfigGroup) => void; onDelete: () => void
  onMoveGroup: (from: number, to: number) => void
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(group.label)
  // checkboxes: rowId -> selected
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // drag-over row index for row reordering
  const dragRowIdx = useRef<number | null>(null)

  const total = groupTotal(group)
  const dispTotal = cfg.currency === 'AUD' ? total * usdToAudRate : total
  const dispFmt = cfg.currency === 'AUD' ? fmtAud : fmt
  const secFmt  = cfg.currency === 'AUD' ? fmt : fmtAud

  const headerColors = ['bg-violet-50 border-b border-violet-100','bg-fuchsia-50 border-b border-fuchsia-100','bg-indigo-50 border-b border-indigo-100','bg-cyan-50 border-b border-cyan-100']
  const headerBg = headerColors[groupIndex % headerColors.length]

  function commitLabel() { onUpdate({ ...group, label: labelVal.trim() || group.label }); setEditLabel(false) }
  function addRow() { onUpdate({ ...group, rows: [...group.rows, emptyRow()] }) }
  function addSubGroup() {
    const sg = { ...emptyGroup(`Sub-group ${group.subGroups.length + 1}`), rows: [emptyRow()] }
    onUpdate({ ...group, subGroups: [...group.subGroups, sg] })
  }
  function updateRow(rowId: string, updated: ConfigRow) { onUpdate({ ...group, rows: group.rows.map(r => r.id === rowId ? updated : r) }) }
  function deleteRow(rowId: string) { onUpdate({ ...group, rows: group.rows.filter(r => r.id !== rowId) }) }
  function reorderRows(from: number, to: number) { onUpdate({ ...group, rows: reorder(group.rows, from, to) }) }
  function updateSubGroup(sg: ConfigGroup) { onUpdate({ ...group, subGroups: group.subGroups.map(s => s.id === sg.id ? sg : s) }) }
  function deleteSubGroup(sgId: string) { onUpdate({ ...group, subGroups: group.subGroups.filter(s => s.id !== sgId) }) }

  // Promote selected rows into a new subgroup
  function promoteToSubGroup() {
    if (selected.size === 0) return
    const rowsToMove = group.rows.filter(r => selected.has(r.id))
    const remaining  = group.rows.filter(r => !selected.has(r.id))
    const sg = { ...emptyGroup(`Sub-group ${group.subGroups.length + 1}`), rows: rowsToMove }
    onUpdate({ ...group, rows: remaining, subGroups: [...group.subGroups, sg] })
    setSelected(new Set())
  }

  // Row drag for reordering
  function handleRowDragStart(idx: number) { dragRowIdx.current = idx }
  function handleRowDrop(toIdx: number) {
    if (dragRowIdx.current !== null && dragRowIdx.current !== toIdx) {
      reorderRows(dragRowIdx.current, toIdx)
    }
    dragRowIdx.current = null
  }

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = group.rows.length > 0 && group.rows.every(r => selected.has(r.id))
  const toggleAll = () => { if (allSelected) setSelected(new Set()); else setSelected(new Set(group.rows.map(r => r.id))) }

  const effectiveUnit = group.unit ?? 'one time'

  return (
    <div>
      {/* Group header */}
      <div className={`flex items-center gap-1.5 px-3 py-2 ${headerBg}`}>
        <button onClick={() => onUpdate({ ...group, collapsed: !group.collapsed })}
          className="text-slate-400 hover:text-slate-600 flex-shrink-0">
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

        {/* Group-level unit selector */}
        {!group.collapsed && (
          <select value={effectiveUnit} onChange={e => onUpdate({ ...group, unit: e.target.value as ConfigRowUnit })}
            title="Default unit for all rows in this group"
            className="text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-violet-400 flex-shrink-0">
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}

        <span className="text-xs font-bold text-slate-500 flex-shrink-0">
          {dispFmt(dispTotal)}
          {showSecondary && <span className="block text-[10px] text-slate-400 text-right">{secFmt(total)}</span>}
        </span>

        {!group.collapsed && (
          <div className="flex gap-1 flex-shrink-0">
            {selected.size > 0 && (
              <button onClick={promoteToSubGroup} title="Move selected rows into a new sub-group"
                className="text-[11px] text-violet-700 bg-violet-100 hover:bg-violet-200 px-1.5 py-0.5 rounded font-semibold transition-colors">
                → Sub ({selected.size})
              </button>
            )}
            <button onClick={addRow} className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Row</button>
            <button onClick={addSubGroup} className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Sub</button>
          </div>
        )}

        {/* Move group up/down */}
        <div className="flex flex-col gap-0 flex-shrink-0">
          <button onClick={() => onMoveGroup(groupIndex, groupIndex - 1)} disabled={groupIndex === 0}
            className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none p-0.5">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 7l3-4 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={() => onMoveGroup(groupIndex, groupIndex + 1)} disabled={groupIndex === totalGroups - 1}
            className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none p-0.5">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <button onClick={onDelete} className="text-slate-300 hover:text-red-500 flex-shrink-0 p-1 rounded transition-colors">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {!group.collapsed && (
        <div>
          {/* Rows */}
          {group.rows.length > 0 && (
            <div>
              <ConfigTableHeader groupUnit={effectiveUnit} showSelect onSelectAll={toggleAll} allSelected={allSelected} />
              {group.rows.map((row, ri) => (
                <ConfigRowEditor
                  key={row.id} row={row} cfg={cfg} groupUnit={effectiveUnit}
                  onChange={r => updateRow(row.id, r)} onDelete={() => deleteRow(row.id)}
                  selected={selected.has(row.id)} onToggleSelect={() => toggleSelect(row.id)}
                  rowIndex={ri} totalRows={group.rows.length}
                  onDragStart={() => handleRowDragStart(ri)}
                  onDrop={() => handleRowDrop(ri)}
                  onMoveRow={(from, to) => reorderRows(from, to)}
                  fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                />
              ))}
            </div>
          )}

          {/* Sub-groups */}
          {group.subGroups.map((sg, sgi) => (
            <SubGroupBlock
              key={sg.id} subGroup={sg} subGroupIndex={sgi}
              totalSubGroups={group.subGroups.length}
              cfg={cfg}
              onUpdate={updateSubGroup}
              onDelete={() => deleteSubGroup(sg.id)}
              onMoveSubGroup={(from, to) => onUpdate({ ...group, subGroups: reorder(group.subGroups, from, to) })}
              fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sub-group ────────────────────────────────────────────────────────────────

function SubGroupBlock({
  subGroup, subGroupIndex, totalSubGroups, cfg, onUpdate, onDelete, onMoveSubGroup,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  subGroup: ConfigGroup; subGroupIndex: number; totalSubGroups: number; cfg: ProductConfiguration
  onUpdate: (g: ConfigGroup) => void; onDelete: () => void
  onMoveSubGroup: (from: number, to: number) => void
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(subGroup.label)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const dragRowIdx = useRef<number | null>(null)

  const total = groupTotal(subGroup)
  const dispTotal = cfg.currency === 'AUD' ? total * usdToAudRate : total
  const dispFmt = cfg.currency === 'AUD' ? fmtAud : fmt
  const secFmt  = cfg.currency === 'AUD' ? fmt : fmtAud
  const subBg = subGroupIndex % 2 === 0 ? 'bg-amber-50' : 'bg-yellow-50'
  const effectiveUnit = subGroup.unit ?? 'one time'

  function commitLabel() { onUpdate({ ...subGroup, label: labelVal.trim() || subGroup.label }); setEditLabel(false) }
  function addRow() { onUpdate({ ...subGroup, rows: [...subGroup.rows, emptyRow()] }) }
  function updateRow(rowId: string, r: ConfigRow) { onUpdate({ ...subGroup, rows: subGroup.rows.map(x => x.id === rowId ? r : x) }) }
  function deleteRow(rowId: string) { onUpdate({ ...subGroup, rows: subGroup.rows.filter(r => r.id !== rowId) }) }
  function reorderRows(from: number, to: number) { onUpdate({ ...subGroup, rows: reorder(subGroup.rows, from, to) }) }

  function handleRowDragStart(idx: number) { dragRowIdx.current = idx }
  function handleRowDrop(toIdx: number) { if (dragRowIdx.current !== null && dragRowIdx.current !== toIdx) reorderRows(dragRowIdx.current, toIdx); dragRowIdx.current = null }

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = subGroup.rows.length > 0 && subGroup.rows.every(r => selected.has(r.id))
  const toggleAll = () => { if (allSelected) setSelected(new Set()); else setSelected(new Set(subGroup.rows.map(r => r.id))) }

  return (
    <div>
      <div className={`flex items-center gap-1.5 px-3 py-1.5 pl-6 ${subBg} border-t border-slate-100`}>
        <button onClick={() => onUpdate({ ...subGroup, collapsed: !subGroup.collapsed })} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className={`transition-transform ${subGroup.collapsed ? '-rotate-90' : ''}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {editLabel ? (
          <input autoFocus value={labelVal} onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel} onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditLabel(false) }}
            className="text-xs font-semibold flex-1 border border-amber-300 rounded px-2 py-0.5 focus:outline-none bg-white" />
        ) : (
          <button onClick={() => { setEditLabel(true); setLabelVal(subGroup.label) }}
            className="text-xs font-semibold text-slate-700 hover:text-amber-700 flex-1 text-left truncate">
            {subGroup.label || '(unnamed sub-group)'}
          </button>
        )}

        {/* Sub-group unit */}
        {!subGroup.collapsed && (
          <select value={effectiveUnit} onChange={e => onUpdate({ ...subGroup, unit: e.target.value as ConfigRowUnit })}
            className="text-[11px] border border-slate-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 flex-shrink-0">
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}

        <span className="text-xs font-semibold text-slate-500 flex-shrink-0">
          {dispFmt(dispTotal)}
          {showSecondary && <span className="block text-[10px] text-slate-400 text-right">{secFmt(total)}</span>}
        </span>

        {!subGroup.collapsed && (
          <button onClick={addRow} className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Row</button>
        )}

        {/* Move sub-group */}
        <div className="flex flex-col gap-0 flex-shrink-0">
          <button onClick={() => onMoveSubGroup(subGroupIndex, subGroupIndex - 1)} disabled={subGroupIndex === 0}
            className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none p-0.5">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 7l3-4 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button onClick={() => onMoveSubGroup(subGroupIndex, subGroupIndex + 1)} disabled={subGroupIndex === totalSubGroups - 1}
            className="text-slate-300 hover:text-slate-600 disabled:opacity-20 leading-none p-0.5">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <button onClick={onDelete} className="text-slate-300 hover:text-red-500 flex-shrink-0 p-1 rounded transition-colors">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {!subGroup.collapsed && (
        <div className="pl-4">
          {subGroup.rows.length === 0 && <p className="text-xs text-slate-400 px-4 py-2">No rows — click +Row above.</p>}
          {subGroup.rows.length > 0 && (
            <>
              <ConfigTableHeader groupUnit={effectiveUnit} showSelect onSelectAll={toggleAll} allSelected={allSelected} indent={1} />
              {subGroup.rows.map((row, ri) => (
                <ConfigRowEditor
                  key={row.id} row={row} cfg={cfg} groupUnit={effectiveUnit}
                  onChange={r => updateRow(row.id, r)} onDelete={() => deleteRow(row.id)}
                  selected={selected.has(row.id)} onToggleSelect={() => toggleSelect(row.id)}
                  rowIndex={ri} totalRows={subGroup.rows.length}
                  onDragStart={() => handleRowDragStart(ri)}
                  onDrop={() => handleRowDrop(ri)}
                  onMoveRow={(from, to) => reorderRows(from, to)}
                  indent={1}
                  fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Table header ─────────────────────────────────────────────────────────────

function ConfigTableHeader({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  groupUnit: _groupUnit, indent = 0, showSelect = false, onSelectAll, allSelected,
}: {
  groupUnit: ConfigRowUnit; indent?: number; showSelect?: boolean
  onSelectAll?: () => void; allSelected?: boolean
}) {
  return (
    <div className={`grid text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 border-t border-b border-slate-100 py-1 ${indent ? 'pl-12' : 'pl-3'}`}
      style={{ gridTemplateColumns: '20px 6px 96px 1fr 52px 80px 80px 80px 52px 86px 28px' }}>
      {/* checkbox */}
      <span className="flex items-center">
        {showSelect && <input type="checkbox" checked={!!allSelected} onChange={onSelectAll} className="w-3 h-3 cursor-pointer" />}
      </span>
      {/* drag handle placeholder */}
      <span />
      <span>Code</span>
      <span>Description</span>
      <span className="text-center">Qty</span>
      <span className="text-right pr-2">Cost</span>
      <span className="text-right pr-2">Floor</span>
      <span className="text-right pr-2">Sell</span>
      <span className="text-center text-[9px]">Unit <span className="text-slate-300 normal-case">(override)</span></span>
      <span className="text-right pr-2">Total</span>
      <span />
    </div>
  )
}

// ─── Row editor ───────────────────────────────────────────────────────────────

function ConfigRowEditor({
  row, cfg, groupUnit, onChange, onDelete, selected, onToggleSelect,
  rowIndex: _rowIndex, totalRows: _totalRows, onDragStart, onDrop, onMoveRow: _onMoveRow,
  indent = 0, fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  row: ConfigRow; cfg: ProductConfiguration; groupUnit: ConfigRowUnit
  onChange: (r: ConfigRow) => void; onDelete: () => void
  selected: boolean; onToggleSelect: () => void
  rowIndex: number; totalRows: number
  onDragStart: () => void; onDrop: () => void
  onMoveRow: (from: number, to: number) => void
  indent?: number
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputIsAud = cfg.currency === 'AUD'
  const rate = usdToAudRate
  const toDisplay = (usd: number) => inputIsAud ? usd * rate : usd
  const toUsd = (v: number) => inputIsAud ? v / rate : v

  const dispCost  = toDisplay(row.costPriceUsd)
  const dispFloor = toDisplay(row.floorPriceUsd)
  const dispSell  = toDisplay(row.sellPriceUsd)
  const totalUsd  = rowTotal(row)
  const dispTotal = toDisplay(totalUsd)
  const dispFmt   = inputIsAud ? fmtAud : fmt
  const secFmt    = inputIsAud ? fmt : fmtAud
  const belowFloor = row.floorPriceUsd > 0 && row.sellPriceUsd < row.floorPriceUsd

  function setField<K extends keyof ConfigRow>(k: K, v: ConfigRow[K]) { onChange({ ...row, [k]: v }) }

  const iCls = "w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"

  // The unit shown for this row: if it matches group default, show placeholder only
  const rowUnit = row.unit ?? groupUnit

  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop() }}
      className={`grid items-center gap-1 px-1 py-0.5 border-b border-slate-50 last:border-0 transition-colors
        ${indent ? 'pl-8' : 'pl-1'}
        ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}
        ${dragOver ? 'border-t-2 border-blue-400 bg-blue-50/50' : ''}
      `}
      style={{ gridTemplateColumns: '20px 6px 96px 1fr 52px 80px 80px 80px 52px 86px 28px' }}
    >
      {/* Checkbox */}
      <input type="checkbox" checked={selected} onChange={onToggleSelect} className="w-3 h-3 cursor-pointer" />

      {/* Drag handle */}
      <span className="cursor-grab text-slate-300 hover:text-slate-500 text-center select-none" title="Drag to reorder">
        ⠿
      </span>

      {/* Code */}
      <input value={row.productCode ?? ''} onChange={e => setField('productCode', e.target.value || undefined)}
        placeholder="Code…" className={`${iCls} font-mono text-[11px] text-slate-500`} />

      {/* Description */}
      <input value={row.description} onChange={e => setField('description', e.target.value)}
        placeholder="Description…" className={iCls} />

      {/* Qty */}
      <input type="number" min="0" step="1" value={row.quantity || ''}
        onChange={e => setField('quantity', parseInt(e.target.value) || 0)}
        className={`${iCls} text-right`} />

      {/* Cost */}
      <input type="number" min="0" step="0.01"
        value={dispCost === 0 ? '' : dispCost.toFixed(2)}
        onChange={e => setField('costPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00" className={`${iCls} text-right`} />

      {/* Floor */}
      <input type="number" min="0" step="0.01"
        value={dispFloor === 0 ? '' : dispFloor.toFixed(2)}
        onChange={e => setField('floorPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00" className={`${iCls} text-right`} />

      {/* Sell */}
      <input type="number" min="0" step="0.01"
        value={dispSell === 0 ? '' : dispSell.toFixed(2)}
        onChange={e => setField('sellPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00"
        className={`${iCls} text-right ${belowFloor ? 'border-red-300 bg-red-50' : ''}`} />

      {/* Unit override — shows group default as placeholder */}
      <select value={rowUnit} onChange={e => setField('unit', e.target.value as ConfigRowUnit)}
        title={`Group default: ${groupUnit}`}
        className={`w-full border rounded px-0.5 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white ${rowUnit === groupUnit ? 'border-slate-100 text-slate-400' : 'border-blue-300 text-blue-700 font-semibold'}`}>
        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>

      {/* Total */}
      <div className="text-right pr-1">
        <p className="text-xs font-semibold text-slate-700">{dispFmt(dispTotal)}</p>
        {showSecondary && totalUsd > 0 && <p className="text-[10px] text-slate-400">{secFmt(totalUsd)}</p>}
      </div>

      {/* Delete */}
      <button onClick={onDelete} className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

// ─── Footer totals ────────────────────────────────────────────────────────────

function ConfigTotalsFooter({ config, fmt, fmtAud, showSecondary, usdToAudRate }: {
  config: ProductConfiguration; fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const totalUsd = config.groups.reduce((s, g) => s + groupTotal(g), 0)
  const dispFmt  = config.currency === 'AUD' ? fmtAud : fmt
  const secFmt   = config.currency === 'AUD' ? fmt : fmtAud
  const dispTotal = config.currency === 'AUD' ? totalUsd * usdToAudRate : totalUsd
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
