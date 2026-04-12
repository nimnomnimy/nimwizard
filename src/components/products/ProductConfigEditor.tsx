import { useState, useCallback, useRef } from 'react'
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
  return g.children.filter((c): c is { type: 'row'; row: ConfigRow } => c.type === 'row').map(c => c.row)
}

function subGroupsOf(g: ConfigGroup): ConfigGroup[] {
  return g.children.filter((c): c is { type: 'subgroup'; group: ConfigGroup } => c.type === 'subgroup').map(c => c.group)
}

function groupTotal(g: ConfigGroup): number {
  return g.children.reduce((s, c) => {
    if (c.type === 'row') return s + c.row.sellPriceUsd * c.row.quantity * (c.row.termMonths ?? 1)
    return s + groupTotal(c.group)
  }, 0)
}

// Build a flat list of move destinations for a given config, excluding the current group/subgroup
function buildDestinations(
  cfg: ProductConfiguration,
  excludeGroupId: string,
): { id: string; label: string; indent: number }[] {
  const result: { id: string; label: string; indent: number }[] = []
  for (const g of cfg.groups) {
    if (g.id !== excludeGroupId) result.push({ id: g.id, label: g.label || '(group)', indent: 0 })
    for (const c of g.children) {
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
    for (const c of g.children) {
      if (c.type === 'subgroup' && c.group.id === id) return { group: c.group, parentGroup: g }
    }
  }
  return null
}

// Deep-update a group anywhere in the tree by id
function updateGroupInConfig(cfg: ProductConfiguration, updated: ConfigGroup): ProductConfiguration {
  function updateInGroup(g: ConfigGroup): ConfigGroup {
    if (g.id === updated.id) return updated
    return { ...g, children: g.children.map(c => c.type === 'subgroup' ? { type: 'subgroup', group: updateInGroup(c.group) } : c) }
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
    const rowsToMove = found.group.children.filter(c => c.type === 'row' && rowIds.has(c.row.id))
    const updatedSource: ConfigGroup = { ...found.group, children: found.group.children.filter(c => !(c.type === 'row' && rowIds.has(c.row.id))) }
    const updatedDest: ConfigGroup = { ...destFound.group, children: [...destFound.group.children, ...rowsToMove] }
    let next = updateGroupInConfig(cfg, updatedSource)
    next = updateGroupInConfig(next, updatedDest)
    updateConfig(next)
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
                Paste your Excel table. First row must be headers with at least <em>Description</em>.
                Optional: ProductID, Quantity, Cost Price, Floor Price, Sell Price, Unit, Term.
                Rows with no ProductID and no prices become group/sub-group headers.
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
                  onUpdate={g => updateConfig(updateGroupInConfig(activeConfig, g))}
                  onDelete={() => deleteTopGroup(activeConfig, group.id)}
                  onMoveGroup={(from, to) => reorderTopGroups(activeConfig, from, to)}
                  onMoveRows={(rowIds, destGroupId) => moveRowsToGroup(activeConfig, rowIds, group.id, destGroupId)}
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
  group, groupIndex, totalGroups, cfg, onUpdate, onDelete, onMoveGroup, onMoveRows,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  group: ConfigGroup; groupIndex: number; totalGroups: number; cfg: ProductConfiguration
  onUpdate: (g: ConfigGroup) => void; onDelete: () => void
  onMoveGroup: (from: number, to: number) => void
  onMoveRows: (rowIds: Set<string>, destGroupId: string) => void
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(group.label)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const dragChildIdx = useRef<number | null>(null)

  const isRecurring = group.pricingType === 'recurring'
  const total    = groupTotal(group)
  const dispTotal = cfg.currency === 'AUD' ? total * usdToAudRate : total
  const dispFmt  = cfg.currency === 'AUD' ? fmtAud : fmt
  const secFmt   = cfg.currency === 'AUD' ? fmt : fmtAud

  const headerColors = ['bg-violet-50 border-b border-violet-100','bg-fuchsia-50 border-b border-fuchsia-100','bg-indigo-50 border-b border-indigo-100','bg-cyan-50 border-b border-cyan-100']
  const headerBg = headerColors[groupIndex % headerColors.length]

  function commitLabel() { onUpdate({ ...group, label: labelVal.trim() || group.label }); setEditLabel(false) }

  function addRow() { onUpdate({ ...group, children: [...group.children, { type: 'row', row: emptyRow() }] }) }

  function addSubGroup() {
    const sg = emptyGroup(`Sub-group ${subGroupsOf(group).length + 1}`, group.pricingType)
    sg.children = [{ type: 'row', row: emptyRow() }]
    // Insert at position 0 so the new sub-group appears at the top
    onUpdate({ ...group, children: [{ type: 'subgroup', group: sg }, ...group.children] })
  }

  function updateChild(idx: number, child: ConfigChild) {
    const next = [...group.children]; next[idx] = child
    onUpdate({ ...group, children: next })
  }

  function deleteChild(idx: number) {
    onUpdate({ ...group, children: group.children.filter((_, i) => i !== idx) })
  }

  function reorderChildren(from: number, to: number) {
    onUpdate({ ...group, children: reorder(group.children, from, to) })
  }

  // Promote selected rows into a new sub-group at the position of the first selected row
  function promoteToSubGroup() {
    if (selected.size === 0) return
    const firstIdx = group.children.findIndex(c => c.type === 'row' && selected.has(c.row.id))
    if (firstIdx < 0) return
    const rowsToMove = group.children.filter(c => c.type === 'row' && selected.has(c.row.id))
    const remaining  = group.children.filter(c => !(c.type === 'row' && selected.has((c as {type:'row';row:ConfigRow}).row.id)))
    const sg = emptyGroup(`Sub-group ${subGroupsOf(group).length + 1}`, group.pricingType)
    sg.children = rowsToMove
    // Insert the sub-group at firstIdx within the remaining list
    const insertAt = Math.min(firstIdx, remaining.length)
    const next = [...remaining.slice(0, insertAt), { type: 'subgroup' as const, group: sg }, ...remaining.slice(insertAt)]
    onUpdate({ ...group, children: next })
    setSelected(new Set())
  }

  const rows = rowsOf(group)
  const allRowsSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAll = () => { if (allRowsSelected) setSelected(new Set()); else setSelected(new Set(rows.map(r => r.id))) }
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
            <button key={pt} onClick={() => onUpdate({ ...group, pricingType: pt })}
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

        <span className="text-xs font-bold text-slate-500 flex-shrink-0">
          {dispFmt(dispTotal)}
          {showSecondary && <span className="block text-[10px] text-slate-400 text-right">{secFmt(total)}</span>}
        </span>

        {!group.collapsed && (
          <div className="flex gap-1 flex-shrink-0 items-center">
            {selected.size > 0 && (
              <>
                <button onClick={promoteToSubGroup} title="Make selected rows a sub-group (keeps position)"
                  className="text-[11px] text-violet-700 bg-violet-100 hover:bg-violet-200 px-1.5 py-0.5 rounded font-semibold transition-colors whitespace-nowrap">
                  → Sub ({selected.size})
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

      {!group.collapsed && group.children.length > 0 && (
        <div>
          <ConfigTableHeader isRecurring={isRecurring} showSelect onSelectAll={toggleAll} allSelected={allRowsSelected} />
          {group.children.map((child, ci) => {
            if (child.type === 'row') {
              return (
                <ConfigRowEditor
                  key={child.row.id} row={child.row} cfg={cfg} isRecurring={isRecurring}
                  groupDefaultUnit={group.defaultUnit ?? 'months'}
                  onChange={r => updateChild(ci, { type: 'row', row: r })}
                  onDelete={() => deleteChild(ci)}
                  selected={selected.has(child.row.id)} onToggleSelect={() => toggleSelect(child.row.id)}
                  onDragStart={() => { dragChildIdx.current = ci }}
                  onDrop={() => { if (dragChildIdx.current !== null && dragChildIdx.current !== ci) reorderChildren(dragChildIdx.current, ci); dragChildIdx.current = null }}
                  fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
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
                parentIsRecurring={isRecurring}
                parentDefaultUnit={group.defaultUnit ?? 'months'}
                onUpdate={sg => updateChild(ci, { type: 'subgroup', group: sg })}
                onDelete={() => deleteChild(ci)}
                onDragStart={() => { dragChildIdx.current = ci }}
                onDrop={() => { if (dragChildIdx.current !== null && dragChildIdx.current !== ci) reorderChildren(dragChildIdx.current, ci); dragChildIdx.current = null }}
                onDropRowInto={() => {
                  // Move the dragged row child into this subgroup
                  const fromIdx = dragChildIdx.current
                  if (fromIdx === null || fromIdx === ci) { dragChildIdx.current = null; return }
                  const dragged = group.children[fromIdx]
                  if (!dragged || dragged.type !== 'row') { dragChildIdx.current = null; return }
                  // Build new children: remove row at fromIdx, update subgroup at ci
                  const updatedSg = { ...child.group, children: [...child.group.children, dragged] }
                  const nextChildren: typeof group.children = []
                  for (let i = 0; i < group.children.length; i++) {
                    if (i === fromIdx) continue // drop the moved row
                    if (i === ci) nextChildren.push({ type: 'subgroup', group: updatedSg })
                    else nextChildren.push(group.children[i])
                  }
                  onUpdate({ ...group, children: nextChildren })
                  dragChildIdx.current = null
                }}
                fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Sub-group ────────────────────────────────────────────────────────────────

function SubGroupBlock({
  subGroup, childIndex, totalChildren: _totalChildren, cfg, parentIsRecurring: _parentIsRecurring, parentDefaultUnit,
  onUpdate, onDelete, onDragStart, onDrop, onDropRowInto,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  subGroup: ConfigGroup; childIndex: number; totalChildren: number; cfg: ProductConfiguration
  parentIsRecurring: boolean; parentDefaultUnit: ConfigRowUnit
  onUpdate: (g: ConfigGroup) => void; onDelete: () => void
  onDragStart: () => void; onDrop: () => void; onDropRowInto: () => void
  fmt: (n: number) => string; fmtAud: (n: number) => string; showSecondary: boolean; usdToAudRate: number
}) {
  const [editLabel, setEditLabel] = useState(false)
  const [labelVal, setLabelVal] = useState(subGroup.label)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)
  const [headerDragOver, setHeaderDragOver] = useState(false)
  const dragChildIdx = useRef<number | null>(null)

  // Sub-group inherits pricing type from parent (user can override)
  const isRecurring = subGroup.pricingType === 'recurring'
  const total = groupTotal(subGroup)
  const dispTotal = cfg.currency === 'AUD' ? total * usdToAudRate : total
  const dispFmt = cfg.currency === 'AUD' ? fmtAud : fmt
  const secFmt  = cfg.currency === 'AUD' ? fmt : fmtAud
  const subBg = childIndex % 2 === 0 ? 'bg-amber-50' : 'bg-yellow-50'
  const effectiveDefaultUnit = subGroup.defaultUnit ?? parentDefaultUnit

  function commitLabel() { onUpdate({ ...subGroup, label: labelVal.trim() || subGroup.label }); setEditLabel(false) }
  function addRow() { onUpdate({ ...subGroup, children: [...subGroup.children, { type: 'row', row: emptyRow() }] }) }

  function updateChild(idx: number, child: ConfigChild) {
    const next = [...subGroup.children]; next[idx] = child
    onUpdate({ ...subGroup, children: next })
  }

  function deleteChild(idx: number) {
    onUpdate({ ...subGroup, children: subGroup.children.filter((_, i) => i !== idx) })
  }

  function reorderChildren(from: number, to: number) {
    onUpdate({ ...subGroup, children: reorder(subGroup.children, from, to) })
  }

  const rows = rowsOf(subGroup)
  const allRowsSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const toggleAll = () => { if (allRowsSelected) setSelected(new Set()); else setSelected(new Set(rows.map(r => r.id))) }
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div
      draggable onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop() }}
      className={dragOver ? 'border-t-2 border-blue-400' : ''}
    >
      <div
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(true) }}
        onDragLeave={e => { e.stopPropagation(); setHeaderDragOver(false) }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); setHeaderDragOver(false); onDropRowInto() }}
        className={`flex items-center gap-1.5 px-3 py-1.5 pl-5 ${subBg} border-t border-slate-100 ${headerDragOver ? 'ring-2 ring-inset ring-blue-400' : ''}`}
      >
        {/* Drag handle for sub-group */}
        <span className="cursor-grab text-slate-300 hover:text-slate-500 select-none text-xs flex-shrink-0" title="Drag to reorder">⠿</span>

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

        {/* Pricing type toggle for sub-group */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {(['one-time', 'recurring'] as ConfigGroupPricingType[]).map(pt => (
            <button key={pt} onClick={() => onUpdate({ ...subGroup, pricingType: pt })}
              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold transition-colors ${
                subGroup.pricingType === pt ? (pt === 'recurring' ? 'bg-indigo-500 text-white' : 'bg-slate-600 text-white') : 'bg-white text-slate-300 hover:text-slate-600 border border-slate-200'
              }`}>
              {pt === 'one-time' ? '1×' : '↻'}
            </button>
          ))}
          {isRecurring && (
            <select value={effectiveDefaultUnit}
              onChange={e => onUpdate({ ...subGroup, defaultUnit: e.target.value as ConfigRowUnit })}
              className="text-[11px] border border-indigo-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 ml-1">
              {RECURRING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
        </div>

        <span className="text-xs font-semibold text-slate-500 flex-shrink-0">
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

      {!subGroup.collapsed && subGroup.children.length > 0 && (
        <div className="pl-4">
          <ConfigTableHeader isRecurring={isRecurring} showSelect onSelectAll={toggleAll} allSelected={allRowsSelected} indent={1} />
          {subGroup.children.map((child, ci) => {
            if (child.type !== 'row') return null // no nested sub-groups beyond 2 levels
            return (
              <ConfigRowEditor
                key={child.row.id} row={child.row} cfg={cfg} isRecurring={isRecurring}
                groupDefaultUnit={effectiveDefaultUnit}
                onChange={r => updateChild(ci, { type: 'row', row: r })}
                onDelete={() => deleteChild(ci)}
                selected={selected.has(child.row.id)} onToggleSelect={() => toggleSelect(child.row.id)}
                onDragStart={() => { dragChildIdx.current = ci }}
                onDrop={() => { if (dragChildIdx.current !== null && dragChildIdx.current !== ci) reorderChildren(dragChildIdx.current, ci); dragChildIdx.current = null }}
                fmt={fmt} fmtAud={fmtAud} showSecondary={showSecondary} usdToAudRate={usdToAudRate}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Table header ─────────────────────────────────────────────────────────────

function ConfigTableHeader({
  isRecurring, indent = 0, showSelect = false, onSelectAll, allSelected,
}: {
  isRecurring: boolean; indent?: number; showSelect?: boolean
  onSelectAll?: () => void; allSelected?: boolean
}) {
  const cols = isRecurring
    ? '20px 8px 90px 1fr 50px 78px 78px 78px 72px 52px 84px 28px'
    : '20px 8px 90px 1fr 50px 78px 78px 78px 84px 28px'
  return (
    <div className={`grid text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 border-t border-b border-slate-100 py-1 ${indent ? 'pl-10' : 'pl-2'}`}
      style={{ gridTemplateColumns: cols }}>
      <span className="flex items-center">
        {showSelect && <input type="checkbox" checked={!!allSelected} onChange={onSelectAll} className="w-3 h-3 cursor-pointer" />}
      </span>
      <span />
      <span>Code</span>
      <span>Description</span>
      <span className="text-center">Qty</span>
      <span className="text-right pr-1">Cost</span>
      <span className="text-right pr-1">Floor</span>
      <span className="text-right pr-1">Sell</span>
      {isRecurring && <span className="text-center">Unit</span>}
      {isRecurring && <span className="text-center">Term</span>}
      <span className="text-right pr-1">Total</span>
      <span />
    </div>
  )
}

// ─── Row editor ───────────────────────────────────────────────────────────────

function ConfigRowEditor({
  row, cfg, isRecurring, groupDefaultUnit, onChange, onDelete, selected, onToggleSelect,
  onDragStart, onDrop,
  fmt, fmtAud, showSecondary, usdToAudRate,
}: {
  row: ConfigRow; cfg: ProductConfiguration; isRecurring: boolean; groupDefaultUnit: ConfigRowUnit
  onChange: (r: ConfigRow) => void; onDelete: () => void
  selected: boolean; onToggleSelect: () => void
  onDragStart: () => void; onDrop: () => void
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
  const totalUsd  = row.sellPriceUsd * row.quantity * (isRecurring ? (row.termMonths ?? 1) : 1)
  const dispTotal = toDisplay(totalUsd)
  const dispFmt   = inputIsAud ? fmtAud : fmt
  const secFmt    = inputIsAud ? fmt : fmtAud
  const belowFloor = row.floorPriceUsd > 0 && row.sellPriceUsd < row.floorPriceUsd

  function setField<K extends keyof ConfigRow>(k: K, v: ConfigRow[K]) { onChange({ ...row, [k]: v }) }

  const iCls = "w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"

  const cols = isRecurring
    ? '20px 8px 90px 1fr 50px 78px 78px 78px 72px 52px 84px 28px'
    : '20px 8px 90px 1fr 50px 78px 78px 78px 84px 28px'

  return (
    <div
      draggable onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart() }}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop() }}
      className={`grid items-center gap-1 py-0.5 border-b border-slate-50 last:border-0 transition-colors
        ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}
        ${dragOver ? 'border-t-2 border-blue-400' : ''}
      `}
      style={{ gridTemplateColumns: cols, paddingLeft: '8px' }}
    >
      <input type="checkbox" checked={selected} onChange={onToggleSelect} className="w-3 h-3 cursor-pointer" />
      <span className="cursor-grab text-slate-300 hover:text-slate-500 select-none text-center text-xs" title="Drag to reorder">⠿</span>
      <input value={row.productCode ?? ''} onChange={e => setField('productCode', e.target.value || undefined)}
        placeholder="Code…" className={`${iCls} font-mono text-[11px] text-slate-500`} />
      <input value={row.description} onChange={e => setField('description', e.target.value)}
        placeholder="Description…" className={iCls} />
      <input type="number" min="0" step="1" value={row.quantity || ''}
        onChange={e => setField('quantity', parseInt(e.target.value) || 0)}
        className={`${iCls} text-right`} />
      <input type="number" min="0" step="0.01"
        value={dispCost === 0 ? '' : dispCost.toFixed(2)}
        onChange={e => setField('costPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00" className={`${iCls} text-right`} />
      <input type="number" min="0" step="0.01"
        value={dispFloor === 0 ? '' : dispFloor.toFixed(2)}
        onChange={e => setField('floorPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00" className={`${iCls} text-right`} />
      <input type="number" min="0" step="0.01"
        value={dispSell === 0 ? '' : dispSell.toFixed(2)}
        onChange={e => setField('sellPriceUsd', toUsd(parseFloat(e.target.value) || 0))}
        placeholder="0.00" className={`${iCls} text-right ${belowFloor ? 'border-red-300 bg-red-50' : ''}`} />
      {isRecurring && (
        <select value={row.unit ?? groupDefaultUnit}
          onChange={e => setField('unit', e.target.value as ConfigRowUnit)}
          className="w-full border border-slate-200 rounded px-0.5 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white">
          {RECURRING_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
      )}
      {isRecurring && (
        <input type="number" min="0" step="1"
          value={row.termMonths ?? ''}
          onChange={e => setField('termMonths', parseInt(e.target.value) || undefined)}
          placeholder="—" className={`${iCls} text-center`} />
      )}
      <div className="text-right pr-1">
        <p className="text-xs font-semibold text-slate-700">{dispFmt(dispTotal)}</p>
        {showSecondary && totalUsd > 0 && <p className="text-[10px] text-slate-400">{secFmt(totalUsd)}</p>}
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
