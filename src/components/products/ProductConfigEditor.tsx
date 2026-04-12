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
  return { id: uid(), label, description: '', collapsed: false, rows: [emptyRow()], subGroups: [] }
}

function emptyConfig(): ProductConfiguration {
  return {
    id: uid(),
    name: 'New Configuration',
    currency: 'USD',
    groups: [emptyGroup('Group 1')],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ─── Row totals ───────────────────────────────────────────────────────────────

function rowTotal(row: ConfigRow): number {
  return row.sellPriceUsd * row.quantity * (row.termMonths ?? 1)
}

function groupTotal(g: ConfigGroup): number {
  const rowSum = g.rows.reduce((s, r) => s + rowTotal(r), 0)
  const subSum = g.subGroups.reduce((s, sg) => s + groupTotal(sg), 0)
  return rowSum + subSum
}

// ─── Paste parser (tab-separated from Excel) ──────────────────────────────────
// Expected columns (any order of the subset we care about):
// ProductID | Category | Description | Quantity | Cost Price | Floor Price | Sell Price | Unit | Term | Total
// We detect columns from the header row.

function parseExcelPaste(text: string, fxRate: number, inputIsAud: boolean): { groups: ConfigGroup[] } | null {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return null

  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())
  const colIdx = (names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n))
      if (i >= 0) return i
    }
    return -1
  }

  const iDesc  = colIdx(['description', 'desc'])
  const iQty   = colIdx(['quantity', 'qty'])
  const iCost  = colIdx(['cost price', 'cost'])
  const iFloor = colIdx(['floor price', 'floor'])
  const iSell  = colIdx(['sell price', 'sell'])
  const iUnit  = colIdx(['unit'])
  const iTerm  = colIdx(['term'])
  const iPCode = colIdx(['productid', 'product id', 'product code', 'code'])

  if (iDesc < 0) return null // need at least a description column

  const toUsd = (raw: string): number => {
    const n = parseFloat(raw.replace(/[^0-9.-]/g, ''))
    if (isNaN(n)) return 0
    return inputIsAud ? n / fxRate : n
  }

  const groups: ConfigGroup[] = []
  let currentTopGroup: ConfigGroup | null = null
  let currentSubGroup: ConfigGroup | null = null

  for (let li = 1; li < lines.length; li++) {
    const cells = lines[li].split('\t').map(c => c.trim())
    const desc = iDesc >= 0 ? cells[iDesc] ?? '' : ''
    const code = iPCode >= 0 ? cells[iPCode] ?? '' : ''
    const qty  = iQty >= 0 ? parseFloat(cells[iQty] ?? '1') || 1 : 1
    const cost  = iCost  >= 0 ? toUsd(cells[iCost]  ?? '0') : 0
    const floor = iFloor >= 0 ? toUsd(cells[iFloor] ?? '0') : 0
    const sell  = iSell  >= 0 ? toUsd(cells[iSell]  ?? '0') : 0
    const rawUnit = (iUnit >= 0 ? cells[iUnit] ?? '' : '').toLowerCase()
    const unit: ConfigRowUnit = UNITS.find(u => u === rawUnit) ?? 'one time'
    const term  = iTerm >= 0 ? parseInt(cells[iTerm] ?? '1') || undefined : undefined

    // Heuristic: if productId column is empty AND description is non-empty → group header row
    const isGroupHeader = code === '' && desc !== '' && cost === 0 && floor === 0 && sell === 0

    if (isGroupHeader) {
      // Detect nesting: if we already have a top group with code content, this could be a subgroup
      // Simple heuristic: first group header becomes top group, subsequent empty-code rows become subgroups
      if (!currentTopGroup) {
        currentTopGroup = emptyGroup(desc)
        currentTopGroup.rows = []
        currentSubGroup = null
        groups.push(currentTopGroup)
      } else {
        currentSubGroup = emptyGroup(desc)
        currentSubGroup.rows = []
        currentTopGroup.subGroups.push(currentSubGroup)
      }
      continue
    }

    if (!desc && !code) continue // skip truly blank rows

    const row: ConfigRow = {
      id: uid(),
      productCode: code || undefined,
      description: desc,
      quantity: qty,
      costPriceUsd: cost,
      floorPriceUsd: floor,
      sellPriceUsd: sell,
      unit,
      termMonths: term,
    }

    const target = currentSubGroup ?? currentTopGroup
    if (target) {
      target.rows.push(row)
    } else {
      // No group yet — create a default one
      currentTopGroup = emptyGroup('Group 1')
      currentTopGroup.rows = [row]
      groups.push(currentTopGroup)
    }
  }

  return groups.length > 0 ? { groups } : null
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  configs: ProductConfiguration[]
  onChange: (configs: ProductConfiguration[]) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProductConfigEditor({ configs, onChange }: Props) {
  const [activeConfigId, setActiveConfigId] = useState<string | null>(
    configs.length > 0 ? configs[0].id : null
  )
  const [editingConfigName, setEditingConfigName] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')

  const usdToAudRate  = useCurrency(s => s.usdToAudRate)
  const fmt           = useCurrency(s => s.fmt)
  const fmtAud        = useCurrency(s => s.fmtAud)
  const showSecondary = useCurrency(s => s.showSecondary)

  const activeConfig = configs.find(c => c.id === activeConfigId) ?? null

  // ── Mutations ────────────────────────────────────────────────────────────────

  const updateConfig = useCallback((updated: ProductConfiguration) => {
    onChange(configs.map(c => c.id === updated.id ? { ...updated, updatedAt: Date.now() } : c))
  }, [configs, onChange])

  const addConfig = () => {
    const c = emptyConfig()
    onChange([...configs, c])
    setActiveConfigId(c.id)
  }

  const deleteConfig = (id: string) => {
    const next = configs.filter(c => c.id !== id)
    onChange(next)
    if (activeConfigId === id) setActiveConfigId(next[0]?.id ?? null)
  }

  // ── Group mutations ───────────────────────────────────────────────────────────

  function addTopGroup(cfg: ProductConfiguration) {
    const g = emptyGroup(`Group ${cfg.groups.length + 1}`)
    updateConfig({ ...cfg, groups: [...cfg.groups, g] })
  }

  function deleteTopGroup(cfg: ProductConfiguration, groupId: string) {
    updateConfig({ ...cfg, groups: cfg.groups.filter(g => g.id !== groupId) })
  }

  function updateTopGroup(cfg: ProductConfiguration, updated: ConfigGroup) {
    updateConfig({ ...cfg, groups: cfg.groups.map(g => g.id === updated.id ? updated : g) })
  }

  function toggleGroupCollapse(cfg: ProductConfiguration, groupId: string) {
    updateConfig({ ...cfg, groups: cfg.groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g) })
  }

  // ── Paste handler ─────────────────────────────────────────────────────────────

  const pasteAreaRef = useRef<HTMLTextAreaElement>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')

  function applyPaste(cfg: ProductConfiguration) {
    const inputIsAud = cfg.currency === 'AUD'
    const result = parseExcelPaste(pasteText, usdToAudRate, inputIsAud)
    if (!result) {
      setPasteError('Could not parse. Ensure the first row is a header with at least a "Description" column.')
      return
    }
    updateConfig({ ...cfg, groups: result.groups })
    setPasteOpen(false)
    setPasteText('')
    setPasteError('')
  }

  // ─────────────────────────────────────────────────────────────────────────────

  if (configs.length === 0 && !activeConfig) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Configurations</p>
          <button onClick={addConfig}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors">
            + New Config
          </button>
        </div>
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 text-sm">
          No configurations yet. Click <strong>+ New Config</strong> to create one or paste from Excel.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Config tabs row */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex-shrink-0">Configurations</p>
        <div className="flex gap-1 flex-wrap flex-1">
          {configs.map(c => (
            <button key={c.id} onClick={() => setActiveConfigId(c.id)}
              className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
                activeConfigId === c.id
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
              }`}>
              {c.name}
            </button>
          ))}
        </div>
        <button onClick={addConfig}
          className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-semibold hover:bg-slate-200 transition-colors flex-shrink-0">
          + Add
        </button>
      </div>

      {activeConfig && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Config header toolbar */}
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center gap-2 flex-wrap">
            {editingConfigName === activeConfig.id ? (
              <input
                autoFocus
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onBlur={() => { updateConfig({ ...activeConfig, name: nameInput.trim() || activeConfig.name }); setEditingConfigName(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { updateConfig({ ...activeConfig, name: nameInput.trim() || activeConfig.name }); setEditingConfigName(null) } if (e.key === 'Escape') setEditingConfigName(null) }}
                className="text-sm font-bold text-slate-800 border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            ) : (
              <button onClick={() => { setEditingConfigName(activeConfig.id); setNameInput(activeConfig.name) }}
                className="text-sm font-bold text-slate-800 hover:text-blue-600 transition-colors">
                {activeConfig.name} ✎
              </button>
            )}

            {/* Currency toggle */}
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[11px] text-slate-400 font-semibold">Prices in:</span>
              {(['USD', 'AUD'] as const).map(c => (
                <button key={c} onClick={() => updateConfig({ ...activeConfig, currency: c })}
                  className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-colors ${
                    activeConfig.currency === c ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                  }`}>
                  {c}
                </button>
              ))}
            </div>

            <button onClick={() => setPasteOpen(v => !v)}
              title="Paste from Excel"
              className={`text-[11px] px-2 py-1 rounded-lg font-semibold border transition-colors ${
                pasteOpen ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}>
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
                Optional columns: ProductID, Category, Quantity, Cost Price, Floor Price, Sell Price, Unit, Term.
                Leave ProductID blank on group header rows.
              </p>
              <textarea
                ref={pasteAreaRef}
                value={pasteText}
                onChange={e => { setPasteText(e.target.value); setPasteError('') }}
                rows={5}
                placeholder="Paste Excel content here (Ctrl+V)…"
                className="w-full font-mono text-xs border border-amber-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-y"
              />
              {pasteError && <p className="text-xs text-red-600">{pasteError}</p>}
              <div className="flex gap-2">
                <button onClick={() => applyPaste(activeConfig)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors">
                  Apply
                </button>
                <button onClick={() => { setPasteOpen(false); setPasteText(''); setPasteError('') }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Groups */}
          {activeConfig.groups.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">
              No groups yet. Click <strong>+ Group</strong> to add one.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeConfig.groups.map((group, gi) => (
                <TopGroupBlock
                  key={group.id}
                  group={group}
                  groupIndex={gi}
                  cfg={activeConfig}
                  onUpdate={g => updateTopGroup(activeConfig, g)}
                  onDelete={() => deleteTopGroup(activeConfig, group.id)}
                  onToggle={() => toggleGroupCollapse(activeConfig, group.id)}
                  fmt={fmt}
                  fmtAud={fmtAud}
                  showSecondary={showSecondary}
                  usdToAudRate={usdToAudRate}
                />
              ))}
            </div>
          )}

          {/* Config footer totals */}
          <ConfigTotalsFooter config={activeConfig} fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate} />
        </div>
      )}
    </div>
  )
}

// ─── Top-level group block ────────────────────────────────────────────────────

function TopGroupBlock({
  group, groupIndex, cfg, onUpdate, onDelete, onToggle,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  group: ConfigGroup
  groupIndex: number
  cfg: ProductConfiguration
  onUpdate: (g: ConfigGroup) => void
  onDelete: () => void
  onToggle: () => void
  fmt: (n: number) => string
  fmtAud: (n: number) => string
  showSecondary: boolean
  usdToAudRate: number
}) {
  const total = groupTotal(group)
  const dispTotal = cfg.currency === 'AUD' ? total * usdToAudRate : total
  const dispFmt = cfg.currency === 'AUD' ? fmtAud : fmt
  const secFmt  = cfg.currency === 'AUD' ? fmt : fmtAud

  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(group.label)

  function commitLabel() {
    onUpdate({ ...group, label: labelVal.trim() || group.label })
    setEditLabel(false)
  }

  function addRow() {
    onUpdate({ ...group, rows: [...group.rows, emptyRow()] })
  }

  function addSubGroup() {
    const sg = emptyGroup(`Sub-group ${group.subGroups.length + 1}`)
    sg.rows = [emptyRow()]
    onUpdate({ ...group, subGroups: [...group.subGroups, sg] })
  }

  function updateRow(rowId: string, updated: ConfigRow) {
    onUpdate({ ...group, rows: group.rows.map(r => r.id === rowId ? updated : r) })
  }

  function deleteRow(rowId: string) {
    onUpdate({ ...group, rows: group.rows.filter(r => r.id !== rowId) })
  }

  function updateSubGroup(sg: ConfigGroup) {
    onUpdate({ ...group, subGroups: group.subGroups.map(s => s.id === sg.id ? sg : s) })
  }

  function deleteSubGroup(sgId: string) {
    onUpdate({ ...group, subGroups: group.subGroups.filter(s => s.id !== sgId) })
  }

  // Purple-ish top-group header
  const headerColors = [
    'bg-violet-50 border-b border-violet-100',
    'bg-fuchsia-50 border-b border-fuchsia-100',
    'bg-indigo-50 border-b border-indigo-100',
    'bg-cyan-50 border-b border-cyan-100',
  ]
  const headerBg = headerColors[groupIndex % headerColors.length]

  return (
    <div>
      {/* Group header */}
      <div className={`flex items-center gap-2 px-3 py-2 ${headerBg}`}>
        <button onClick={onToggle} className="text-slate-400 hover:text-slate-600 flex-shrink-0" title={group.collapsed ? 'Expand' : 'Collapse'}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${group.collapsed ? '-rotate-90' : ''}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {editLabel ? (
          <input autoFocus value={labelVal} onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditLabel(false) }}
            className="text-sm font-bold flex-1 border border-violet-300 rounded px-2 py-0.5 focus:outline-none bg-white"
          />
        ) : (
          <button onClick={() => { setEditLabel(true); setLabelVal(group.label) }}
            className="text-sm font-bold text-slate-800 hover:text-violet-700 flex-1 text-left truncate">
            {group.label || '(unnamed group)'}
          </button>
        )}

        <span className="text-xs font-bold text-slate-500 ml-auto flex-shrink-0">
          {dispFmt(dispTotal)}
          {showSecondary && <span className="block text-[10px] text-slate-400 text-right">{secFmt(total)}</span>}
        </span>

        {!group.collapsed && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={addRow} title="Add row" className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Row</button>
            <button onClick={addSubGroup} title="Add sub-group" className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Sub</button>
          </div>
        )}

        <button onClick={onDelete} className="text-slate-300 hover:text-red-500 flex-shrink-0 p-1 rounded transition-colors" title="Delete group">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {!group.collapsed && (
        <div>
          {/* Rows in this top group */}
          {group.rows.length > 0 && (
            <div>
              <ConfigTableHeader />
              {group.rows.map(row => (
                <ConfigRowEditor
                  key={row.id}
                  row={row}
                  cfg={cfg}
                  onChange={r => updateRow(row.id, r)}
                  onDelete={() => deleteRow(row.id)}
                  indent={0}
                  fmt={fmt}
                  fmtAud={fmtAud}
                  showSecondary={showSecondary}
                  usdToAudRate={usdToAudRate}
                />
              ))}
            </div>
          )}

          {/* Sub-groups */}
          {group.subGroups.map((sg, sgi) => (
            <SubGroupBlock
              key={sg.id}
              subGroup={sg}
              subGroupIndex={sgi}
              cfg={cfg}
              onUpdate={updateSubGroup}
              onDelete={() => deleteSubGroup(sg.id)}
              fmt={fmt}
              fmtAud={fmtAud}
              showSecondary={showSecondary}
              usdToAudRate={usdToAudRate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Sub-group block ──────────────────────────────────────────────────────────

function SubGroupBlock({
  subGroup, subGroupIndex, cfg, onUpdate, onDelete,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  subGroup: ConfigGroup
  subGroupIndex: number
  cfg: ProductConfiguration
  onUpdate: (g: ConfigGroup) => void
  onDelete: () => void
  fmt: (n: number) => string
  fmtAud: (n: number) => string
  showSecondary: boolean
  usdToAudRate: number
}) {
  const total = groupTotal(subGroup)
  const dispTotal = cfg.currency === 'AUD' ? total * usdToAudRate : total
  const dispFmt = cfg.currency === 'AUD' ? fmtAud : fmt
  const secFmt  = cfg.currency === 'AUD' ? fmt : fmtAud

  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(subGroup.label)

  function commitLabel() {
    onUpdate({ ...subGroup, label: labelVal.trim() || subGroup.label })
    setEditLabel(false)
  }

  function addRow() {
    onUpdate({ ...subGroup, rows: [...subGroup.rows, emptyRow()] })
  }

  function updateRow(rowId: string, updated: ConfigRow) {
    onUpdate({ ...subGroup, rows: subGroup.rows.map(r => r.id === rowId ? updated : r) })
  }

  function deleteRow(rowId: string) {
    onUpdate({ ...subGroup, rows: subGroup.rows.filter(r => r.id !== rowId) })
  }

  const subBg = subGroupIndex % 2 === 0 ? 'bg-amber-50' : 'bg-yellow-50'

  return (
    <div>
      {/* Sub-group header */}
      <div className={`flex items-center gap-2 px-3 py-1.5 pl-6 ${subBg} border-t border-slate-100`}>
        <button onClick={() => onUpdate({ ...subGroup, collapsed: !subGroup.collapsed })}
          className="text-slate-400 hover:text-slate-600 flex-shrink-0">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className={`transition-transform ${subGroup.collapsed ? '-rotate-90' : ''}`}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {editLabel ? (
          <input autoFocus value={labelVal} onChange={e => setLabelVal(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditLabel(false) }}
            className="text-xs font-semibold flex-1 border border-amber-300 rounded px-2 py-0.5 focus:outline-none bg-white"
          />
        ) : (
          <button onClick={() => { setEditLabel(true); setLabelVal(subGroup.label) }}
            className="text-xs font-semibold text-slate-700 hover:text-amber-700 flex-1 text-left truncate">
            {subGroup.label || '(unnamed sub-group)'}
          </button>
        )}

        <span className="text-xs font-semibold text-slate-500 ml-auto flex-shrink-0">
          {dispFmt(dispTotal)}
          {showSecondary && <span className="block text-[10px] text-slate-400 text-right">{secFmt(total)}</span>}
        </span>

        {!subGroup.collapsed && (
          <button onClick={addRow} className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-white transition-colors">+Row</button>
        )}

        <button onClick={onDelete} className="text-slate-300 hover:text-red-500 flex-shrink-0 p-1 rounded transition-colors">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {!subGroup.collapsed && (
        <div className="pl-4">
          {subGroup.rows.length === 0 && (
            <p className="text-xs text-slate-400 px-4 py-2">No rows — click +Row above.</p>
          )}
          {subGroup.rows.length > 0 && <ConfigTableHeader indent={1} />}
          {subGroup.rows.map(row => (
            <ConfigRowEditor
              key={row.id}
              row={row}
              cfg={cfg}
              onChange={r => updateRow(row.id, r)}
              onDelete={() => deleteRow(row.id)}
              indent={1}
              fmt={fmt}
              fmtAud={fmtAud}
              showSecondary={showSecondary}
              usdToAudRate={usdToAudRate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Table header ─────────────────────────────────────────────────────────────

function ConfigTableHeader({ indent = 0 }: { indent?: number }) {
  return (
    <div className={`grid text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 border-t border-b border-slate-100 py-1 ${indent ? 'pl-8' : 'pl-3'}`}
      style={{ gridTemplateColumns: '100px 1fr 56px 88px 88px 88px 72px 56px 90px 32px' }}>
      <span>Code</span>
      <span>Description</span>
      <span className="text-center">Qty</span>
      <span className="text-right pr-2">Cost</span>
      <span className="text-right pr-2">Floor</span>
      <span className="text-right pr-2">Sell/Unit</span>
      <span className="text-center">Unit</span>
      <span className="text-center">Term</span>
      <span className="text-right pr-2">Total</span>
      <span></span>
    </div>
  )
}

// ─── Individual row editor ────────────────────────────────────────────────────

function ConfigRowEditor({
  row, cfg, onChange, onDelete, indent,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  row: ConfigRow
  cfg: ProductConfiguration
  onChange: (r: ConfigRow) => void
  onDelete: () => void
  indent: number
  fmt: (n: number) => string
  fmtAud: (n: number) => string
  showSecondary: boolean
  usdToAudRate: number
}) {
  const inputIsAud = cfg.currency === 'AUD'
  const rate = usdToAudRate

  // Display value: stored in USD, displayed in cfg.currency
  const toDisplay = (usd: number) => inputIsAud ? usd * rate : usd
  const toUsd = (display: number) => inputIsAud ? display / rate : display

  const dispCost  = toDisplay(row.costPriceUsd)
  const dispFloor = toDisplay(row.floorPriceUsd)
  const dispSell  = toDisplay(row.sellPriceUsd)

  const totalUsd = rowTotal(row)
  const dispTotal = toDisplay(totalUsd)
  const dispFmt = inputIsAud ? fmtAud : fmt
  const secFmt  = inputIsAud ? fmt : fmtAud

  function setField<K extends keyof ConfigRow>(k: K, v: ConfigRow[K]) {
    onChange({ ...row, [k]: v })
  }

  const inputCls = "w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 text-right bg-white"
  const textInputCls = "w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"

  return (
    <div className={`grid items-center gap-1 px-1 py-1 hover:bg-slate-50 border-b border-slate-50 last:border-0 ${indent ? 'pl-8' : 'pl-3'}`}
      style={{ gridTemplateColumns: '100px 1fr 56px 88px 88px 88px 72px 56px 90px 32px' }}>

      {/* Code */}
      <input
        value={row.productCode ?? ''}
        onChange={e => setField('productCode', e.target.value || undefined)}
        placeholder="Code…"
        className={`${textInputCls} font-mono text-[11px] text-slate-500`}
      />

      {/* Description */}
      <input
        value={row.description}
        onChange={e => setField('description', e.target.value)}
        placeholder="Description…"
        className={textInputCls}
      />

      {/* Qty */}
      <input type="number" min="0" step="1"
        value={row.quantity}
        onChange={e => setField('quantity', parseInt(e.target.value) || 0)}
        className={inputCls}
      />

      {/* Cost */}
      <input type="number" min="0" step="0.01"
        value={dispCost === 0 ? '' : dispCost.toFixed(2)}
        onChange={e => setField('costPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00"
        className={inputCls}
      />

      {/* Floor */}
      <input type="number" min="0" step="0.01"
        value={dispFloor === 0 ? '' : dispFloor.toFixed(2)}
        onChange={e => setField('floorPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00"
        className={inputCls}
      />

      {/* Sell/Unit */}
      <input type="number" min="0" step="0.01"
        value={dispSell === 0 ? '' : dispSell.toFixed(2)}
        onChange={e => setField('sellPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00"
        className={`${inputCls} ${row.sellPriceUsd < row.floorPriceUsd && row.floorPriceUsd > 0 ? 'border-red-300 bg-red-50' : ''}`}
      />

      {/* Unit */}
      <select
        value={row.unit}
        onChange={e => setField('unit', e.target.value as ConfigRowUnit)}
        className="w-full border border-slate-200 rounded px-1 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
      </select>

      {/* Term */}
      <input type="number" min="0" step="1"
        value={row.termMonths ?? ''}
        onChange={e => setField('termMonths', parseInt(e.target.value) || undefined)}
        placeholder="—"
        className={`${inputCls} text-center`}
      />

      {/* Total */}
      <div className="text-right pr-2">
        <p className="text-xs font-semibold text-slate-700">{dispFmt(dispTotal)}</p>
        {showSecondary && totalUsd > 0 && (
          <p className="text-[10px] text-slate-400">{secFmt(totalUsd)}</p>
        )}
      </div>

      {/* Delete */}
      <button onClick={onDelete}
        className="p-1 text-slate-300 hover:text-red-500 transition-colors rounded">
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

// ─── Footer totals ────────────────────────────────────────────────────────────

function ConfigTotalsFooter({
  config, fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  config: ProductConfiguration
  fmt: (n: number) => string
  fmtAud: (n: number) => string
  showSecondary: boolean
  usdToAudRate: number
}) {
  const totalUsd = config.groups.reduce((s, g) => s + groupTotal(g), 0)
  const dispFmt = config.currency === 'AUD' ? fmtAud : fmt
  const secFmt  = config.currency === 'AUD' ? fmt : fmtAud
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
