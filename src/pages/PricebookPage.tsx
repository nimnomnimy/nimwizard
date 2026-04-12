import React, { useEffect, useRef, useState, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useCurrency } from '../store/useCurrency'
import { uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import CurrencyBar from '../components/ui/CurrencyBar'
import { useResizable } from '../hooks/useResizable'
import { exportPricebooksJSON, exportPricebooksXLSX, importPricebooksJSON } from '../lib/exportUtils'
import type { Pricebook, PricebookEntry, UpliftConfig, UpliftType } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyUplift(): UpliftConfig {
  return { type: 'none', percentage: 0, applyAnnually: false }
}

function emptyEntry(): PricebookEntry {
  return { id: uid(), productId: '', productName: '', unitPriceUsd: 0, freightIncluded: false, specialTerms: [] }
}

type DraftState = Omit<Pricebook, 'id' | 'createdAt' | 'updatedAt'>

function emptyDraft(): DraftState {
  return {
    customerName: '',
    customFxRate: undefined,
    notes: '',
    validFrom: '',
    validTo: '',
    entries: [emptyEntry()],
    defaultUplift: emptyUplift(),
  }
}

function pbToDraft(p: Pricebook): DraftState {
  return {
    customerName: p.customerName,
    customFxRate: p.customFxRate,
    notes: p.notes ?? '',
    validFrom: p.validFrom ?? '',
    validTo: p.validTo ?? '',
    entries: p.entries.map(e => ({ ...e, specialTerms: e.specialTerms ?? [] })),
    defaultUplift: p.defaultUplift ? { ...p.defaultUplift } : emptyUplift(),
  }
}

function validityStatus(p: Pricebook): 'active' | 'upcoming' | 'expired' | 'no-dates' {
  if (!p.validFrom && !p.validTo) return 'no-dates'
  const today = new Date().toISOString().slice(0, 10)
  if (p.validFrom && today < p.validFrom) return 'upcoming'
  if (p.validTo && today > p.validTo) return 'expired'
  return 'active'
}

function validityBadge(p: Pricebook): { label: string; cls: string } | null {
  const s = validityStatus(p)
  if (s === 'no-dates') return null
  if (s === 'active')   return { label: 'Active',   cls: 'bg-green-100 text-green-700 border-green-200' }
  if (s === 'upcoming') return { label: 'Upcoming', cls: 'bg-blue-100 text-blue-700 border-blue-200' }
  return { label: 'Expired', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
}

function formatDate(d: string | undefined): string {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function applyUplift(price: number, uplift: UpliftConfig | undefined): number {
  if (!uplift || uplift.type === 'none' || uplift.percentage === 0) return price
  return price * (1 + uplift.percentage / 100)
}

function upliftLabel(uplift: UpliftConfig | undefined): string | null {
  if (!uplift || uplift.type === 'none') return null
  const tag = uplift.label || (uplift.type === 'cpi' ? 'CPI' : 'Uplift')
  return `+${uplift.percentage}% ${tag}${uplift.applyAnnually ? '/yr' : ''}`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricebookPage() {
  const pricebooks      = useAppStore(s => s.pricebooks)
  const products        = useAppStore(s => s.dealProducts)
  const addPricebook    = useAppStore(s => s.addPricebook)
  const updatePricebook = useAppStore(s => s.updatePricebook)
  const deletePricebook = useAppStore(s => s.deletePricebook)
  const fmt             = useCurrency(s => s.fmt)
  const fmtAud          = useCurrency(s => s.fmtAud)
  const showSecondary   = useCurrency(s => s.showSecondary)

  const left = useResizable({ initial: 260, min: 180, max: 420 })

  // null = new pricebook, string = existing id, undefined = nothing selected
  const [activeId, setActiveId]           = useState<string | null | undefined>(undefined)
  const [draft, setDraft]                 = useState<DraftState>(emptyDraft())
  const [dirty, setDirty]                 = useState(false)
  const [search, setSearch]               = useState('')
  const [groupByCustomer, setGroupByCustomer] = useState(true)
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())
  const [showExportMenu, setShowExportMenu] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const nameRef   = useRef<HTMLInputElement>(null)

  const isNew    = activeId === null
  const existing = typeof activeId === 'string' ? (pricebooks.find(p => p.id === activeId) ?? null) : null

  // Load draft when selection changes
  useEffect(() => {
    if (activeId === null) {
      setDraft(emptyDraft())
      setDirty(false)
      setTimeout(() => nameRef.current?.focus(), 50)
    } else if (existing) {
      setDraft(pbToDraft(existing))
      setDirty(false)
    }
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  function patch(p: Partial<DraftState>) {
    setDraft(d => ({ ...d, ...p }))
    setDirty(true)
  }

  // ── Filtering / grouping ───────────────────────────────────────────────────
  const filtered = useMemo(() =>
    [...pricebooks]
      .filter(p => p.customerName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || b.createdAt - a.createdAt),
    [pricebooks, search]
  )

  const customerGroups = useMemo(() => {
    const map = new Map<string, Pricebook[]>()
    for (const p of filtered) {
      const key = p.customerName.trim() || '(No Name)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  function toggleCustomerExpand(name: string) {
    setExpandedCustomers(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  function handleSave() {
    if (!draft.customerName.trim()) return
    const ts = Date.now()
    const payload: DraftState = {
      ...draft,
      customFxRate: draft.customFxRate && draft.customFxRate > 0 ? draft.customFxRate : undefined,
      defaultUplift: draft.defaultUplift?.type === 'none' ? undefined : draft.defaultUplift,
      validFrom: draft.validFrom?.trim() || undefined,
      validTo: draft.validTo?.trim() || undefined,
    }
    if (existing) {
      updatePricebook({ id: existing.id, ...payload, createdAt: existing.createdAt, updatedAt: ts })
      showToast(`${payload.customerName} updated`, 'success')
    } else {
      const id = uid()
      addPricebook({ id, ...payload, createdAt: ts, updatedAt: ts })
      setActiveId(id)
      showToast(`${payload.customerName} created`, 'success')
    }
    setDirty(false)
  }

  function handleDelete() {
    if (!existing) return
    if (!confirm(`Delete this pricebook for "${existing.customerName}"?`)) return
    deletePricebook(existing.id)
    showToast('Pricebook deleted')
    setActiveId(undefined)
  }

  // ── Import ────────────────────────────────────────────────────────────────
  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const imported = importPricebooksJSON(ev.target?.result as string)
        const existingIds = new Set(pricebooks.map(p => p.id))
        let added = 0
        for (const pb of imported) {
          if (existingIds.has(pb.id)) { updatePricebook(pb); added++ }
          else { addPricebook(pb); added++ }
        }
        showToast(`Imported ${added} pricebook(s)`, 'success')
      } catch {
        showToast('Import failed: invalid file', 'error')
      }
    }
    reader.readAsText(file)
  }

  // ── Entry helpers ─────────────────────────────────────────────────────────
  function setEntry(idx: number, p: Partial<PricebookEntry>) {
    const entries = draft.entries.map((e, i) => i === idx ? { ...e, ...p } : e)
    patch({ entries })
  }

  function handleProductSelect(idx: number, productId: string) {
    const p = products.find(x => x.id === productId)
    setEntry(idx, { productId, productName: p?.name ?? '', unitPriceUsd: p?.defaultSellPrice ?? 0 })
  }

  function setDefaultUplift(p: Partial<UpliftConfig>) {
    patch({ defaultUplift: { ...(draft.defaultUplift ?? emptyUplift()), ...p } })
  }

  function addTerm(idx: number) {
    setEntry(idx, { specialTerms: [...(draft.entries[idx].specialTerms ?? []), ''] })
  }
  function setTerm(entryIdx: number, termIdx: number, value: string) {
    const terms = [...(draft.entries[entryIdx].specialTerms ?? [])]
    terms[termIdx] = value
    setEntry(entryIdx, { specialTerms: terms })
  }
  function removeTerm(entryIdx: number, termIdx: number) {
    setEntry(entryIdx, { specialTerms: (draft.entries[entryIdx].specialTerms ?? []).filter((_, i) => i !== termIdx) })
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 flex items-center gap-3 flex-wrap" style={{ minHeight: 52 }}>
        <h2 className="text-sm font-bold text-slate-700 flex-shrink-0">Pricebooks</h2>
        <CurrencyBar />
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <button onClick={() => importRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6l3.5 3.5L10 6M2 11h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Import
          </button>
          <div className="relative">
            <button onClick={() => setShowExportMenu(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 9V1M3 4l3.5-3.5L10 4M2 11h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Export
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[130px] py-1"
                onMouseLeave={() => setShowExportMenu(false)}>
                <button onClick={() => { exportPricebooksJSON(pricebooks); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Export JSON</button>
                <button onClick={() => { exportPricebooksXLSX(pricebooks, products); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Export Excel</button>
              </div>
            )}
          </div>
          <button onClick={() => setActiveId(null)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors">
            + New Pricebook
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden select-none">
        {/* ── Left pane ── */}
        {left.isOpen ? (
          <>
          <div style={{ width: left.width }} className="flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
            <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">All Pricebooks ({pricebooks.length})</span>
                <button onClick={() => left.setIsOpen(false)} className="text-slate-300 hover:text-slate-500 p-1 rounded" title="Collapse">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search customer…"
                className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-1">
                <button onClick={() => setGroupByCustomer(true)}
                  className={`flex-1 text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors ${groupByCustomer ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  By Customer
                </button>
                <button onClick={() => setGroupByCustomer(false)}
                  className={`flex-1 text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors ${!groupByCustomer ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  All
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
              {filtered.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8">No pricebooks yet.</p>
              )}

              {groupByCustomer ? customerGroups.map(([customerName, books]) => {
                const isExpanded = expandedCustomers.has(customerName) || books.some(b => b.id === activeId)
                const hasActive  = books.some(b => b.id === activeId)
                return (
                  <div key={customerName}>
                    <button onClick={() => toggleCustomerExpand(customerName)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-colors ${hasActive ? 'text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}>
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                        className={`flex-shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}>
                        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="text-xs font-bold truncate flex-1">{customerName}</span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{books.length}</span>
                    </button>
                    {isExpanded && books.map(p => {
                      const badge = validityBadge(p)
                      return (
                        <button key={p.id} onClick={() => setActiveId(p.id)}
                          className={`w-full text-left pl-5 pr-3 py-1.5 rounded-lg text-sm transition-colors ${activeId === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                          <div className="flex items-center justify-between gap-1">
                            <p className="text-xs font-semibold text-slate-700 truncate flex-1">
                              {p.notes?.trim() ? p.notes.trim() : `${p.entries.length} product${p.entries.length !== 1 ? 's' : ''}`}
                            </p>
                            {badge && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${badge.cls}`}>{badge.label}</span>}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {(p.validFrom || p.validTo) && (
                              <span className="text-[11px] text-slate-400">
                                {p.validFrom ? formatDate(p.validFrom) : '∞'} – {p.validTo ? formatDate(p.validTo) : '∞'}
                              </span>
                            )}
                            <span className="text-[11px] text-slate-400">
                              {p.entries.length} item{p.entries.length !== 1 ? 's' : ''}
                              {p.customFxRate ? ` · FX ${p.customFxRate.toFixed(4)}` : ''}
                            </span>
                            {p.defaultUplift && p.defaultUplift.type !== 'none' && (
                              <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
                                {upliftLabel(p.defaultUplift)}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              }) : filtered.map(p => {
                const badge = validityBadge(p)
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${activeId === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                    <div className="flex items-center justify-between gap-1">
                      <p className="font-semibold text-slate-800 truncate text-xs flex-1">{p.customerName}</p>
                      {badge && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${badge.cls}`}>{badge.label}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {(p.validFrom || p.validTo) && (
                        <span className="text-[11px] text-slate-400">
                          {p.validFrom ? formatDate(p.validFrom) : '∞'} – {p.validTo ? formatDate(p.validTo) : '∞'}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {p.entries.length} product{p.entries.length !== 1 ? 's' : ''}
                        {p.customFxRate ? ` · FX ${p.customFxRate.toFixed(4)}` : ''}
                      </span>
                      {p.defaultUplift && p.defaultUplift.type !== 'none' && (
                        <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-1.5 py-0.5 rounded-full">
                          {upliftLabel(p.defaultUplift)}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <div {...left.dragHandleProps} className="w-1.5 flex-shrink-0 cursor-col-resize group">
            <div className="w-px h-full bg-slate-200 group-hover:bg-blue-400 mx-auto transition-colors" />
          </div>
          </>
        ) : (
          <button onClick={() => left.setIsOpen(true)}
            className="w-7 flex-shrink-0 border-r border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-300 hover:text-slate-500 transition-colors"
            title="Expand list">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}

        {/* ── Right pane ── */}
        <div className="flex-1 overflow-y-auto bg-white">
          {activeId === undefined ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              Select a pricebook or click + New Pricebook
            </div>
          ) : (
            <PricebookDetailPane
              key={activeId ?? '__new__'}
              isNew={isNew}
              existing={existing}
              draft={draft}
              dirty={dirty}
              products={products}
              fmt={fmt}
              fmtAud={fmtAud}
              showSecondary={showSecondary}
              nameRef={nameRef}
              patch={patch}
              setEntry={setEntry}
              handleProductSelect={handleProductSelect}
              setDefaultUplift={setDefaultUplift}
              addTerm={addTerm}
              setTerm={setTerm}
              removeTerm={removeTerm}
              onSave={handleSave}
              onDelete={handleDelete}
              onAddEntry={() => patch({ entries: [...draft.entries, emptyEntry()] })}
              onRemoveEntry={idx => patch({ entries: draft.entries.filter((_, i) => i !== idx) })}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Detail / edit pane ───────────────────────────────────────────────────────

function PricebookDetailPane({
  isNew, existing, draft, dirty, products, fmt, fmtAud, showSecondary,
  nameRef, patch, setEntry, handleProductSelect, setDefaultUplift,
  addTerm, setTerm, removeTerm, onSave, onDelete, onAddEntry, onRemoveEntry,
}: {
  isNew: boolean
  existing: Pricebook | null
  draft: DraftState
  dirty: boolean
  products: ReturnType<typeof useAppStore>['dealProducts'] extends never ? never : any[]
  fmt: (n: number) => string
  fmtAud: (n: number) => string
  showSecondary: boolean
  nameRef: React.RefObject<HTMLInputElement | null>
  patch: (p: Partial<DraftState>) => void
  setEntry: (idx: number, p: Partial<PricebookEntry>) => void
  handleProductSelect: (idx: number, productId: string) => void
  setDefaultUplift: (p: Partial<UpliftConfig>) => void
  addTerm: (idx: number) => void
  setTerm: (entryIdx: number, termIdx: number, value: string) => void
  removeTerm: (entryIdx: number, termIdx: number) => void
  onSave: () => void
  onDelete: () => void
  onAddEntry: () => void
  onRemoveEntry: (idx: number) => void
}) {
  const fxStr  = draft.customFxRate != null ? String(draft.customFxRate) : ''
  const hasFx  = draft.customFxRate != null && draft.customFxRate > 0

  function handleFxInput(v: string) {
    const n = parseFloat(v)
    patch({ customFxRate: v === '' ? undefined : (isNaN(n) ? undefined : n) })
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col h-full">
      {/* Top action bar */}
      <div className="flex items-center gap-2 px-6 pt-4 pb-3 flex-shrink-0 border-b border-slate-100">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-500">
            {isNew ? 'New Pricebook' : existing?.customerName}
          </h2>
        </div>
        {!isNew && (
          <button type="button" onClick={onDelete}
            className="px-3 py-1.5 rounded-lg border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
            Delete
          </button>
        )}
        <button type="button" onClick={onSave} disabled={!dirty && !isNew}
          className="px-4 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {isNew ? 'Create Pricebook' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">

        {/* ── Customer name ── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer Name</label>
          <input
            ref={nameRef}
            value={draft.customerName}
            onChange={e => patch({ customerName: e.target.value })}
            placeholder="Acme Corporation"
            className="text-2xl font-bold text-slate-900 bg-transparent border-0 focus:outline-none focus:bg-slate-50 rounded-lg px-1 py-0.5 -ml-1 w-full placeholder:text-slate-300"
          />
        </div>

        {/* ── FX rate ── */}
        <div className="flex flex-col gap-2 bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Customer FX Rate (USD → AUD)</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">1 USD =</span>
              <input
                type="text"
                inputMode="decimal"
                value={fxStr}
                onChange={e => handleFxInput(e.target.value)}
                placeholder="e.g. 1.5800"
                className="w-32 px-3 py-2 border border-blue-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
              <span className="text-sm text-slate-500">AUD</span>
            </div>
            {hasFx && (
              <span className="text-[11px] text-blue-600 bg-white px-2.5 py-1 rounded-full border border-blue-200 font-semibold">
                A$1 = {(1 / draft.customFxRate!).toFixed(4)} USD
              </span>
            )}
            {hasFx && (
              <button type="button" onClick={() => patch({ customFxRate: undefined })}
                className="text-[11px] text-slate-400 hover:text-red-500 transition-colors">
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-blue-500">Leave blank to use the global FX rate from the top bar.</p>
        </div>

        {/* ── Validity dates ── */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Validity Period</label>
          <div className="flex gap-3 items-center flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">Valid From</label>
              <input type="date" value={draft.validFrom ?? ''}
                onChange={e => patch({ validFrom: e.target.value })}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <span className="text-slate-400 text-sm mt-4">→</span>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-slate-400">Valid To</label>
              <input type="date" value={draft.validTo ?? ''}
                onChange={e => patch({ validTo: e.target.value })}
                min={draft.validFrom ?? undefined}
                className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {(draft.validFrom || draft.validTo) && (
              <button type="button" onClick={() => patch({ validFrom: '', validTo: '' })}
                className="text-[11px] text-slate-400 hover:text-red-500 mt-4 transition-colors">
                Clear dates
              </button>
            )}
          </div>
          {draft.validFrom && draft.validTo && draft.validFrom > draft.validTo && (
            <p className="text-xs text-red-500">Valid From must be before Valid To.</p>
          )}
        </div>

        {/* ── Default uplift ── */}
        <div className="flex flex-col gap-2 bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Default Price Uplift</p>
          <div className="flex gap-2 flex-wrap">
            {(['none', 'cpi', 'fixed'] as UpliftType[]).map(t => (
              <button key={t} type="button" onClick={() => setDefaultUplift({ type: t })}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${(draft.defaultUplift?.type ?? 'none') === t ? 'bg-amber-500 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {t === 'none' ? 'None' : t === 'cpi' ? 'CPI' : 'Fixed %'}
              </button>
            ))}
          </div>
          {draft.defaultUplift?.type !== 'none' && (
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400">Percentage</label>
                <div className="relative w-28">
                  <input type="number" min="0" step="0.01" value={draft.defaultUplift?.percentage ?? ''}
                    onChange={e => setDefaultUplift({ percentage: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                    className="w-full pr-5 pl-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">%</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400">Label (optional)</label>
                <input value={draft.defaultUplift?.label ?? ''}
                  onChange={e => setDefaultUplift({ label: e.target.value })}
                  placeholder={draft.defaultUplift?.type === 'cpi' ? 'CPI' : 'Uplift'}
                  className="w-32 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer pb-1.5">
                <input type="checkbox" checked={draft.defaultUplift?.applyAnnually ?? false}
                  onChange={e => setDefaultUplift({ applyAnnually: e.target.checked })}
                  className="rounded border-slate-300" />
                <span className="text-xs text-slate-600">Apply annually</span>
              </label>
            </div>
          )}
        </div>

        {/* ── Notes ── */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
          <textarea value={draft.notes} onChange={e => patch({ notes: e.target.value })}
            rows={2} placeholder="Optional notes…"
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>

        {/* ── Products / entries ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Products</label>
            <button type="button" onClick={onAddEntry}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold">+ Add Product</button>
          </div>

          {draft.entries.map((entry, idx) => (
            <div key={entry.id} className="bg-slate-50 rounded-xl p-4 flex flex-col gap-3 border border-slate-100">
              <div className="flex gap-3 items-start">
                {/* Product selector */}
                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-slate-400">Product</label>
                  {products.length > 0 ? (
                    <select value={entry.productId} onChange={e => handleProductSelect(idx, e.target.value)}
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">— Select —</option>
                      {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <input value={entry.productName} onChange={e => setEntry(idx, { productName: e.target.value })}
                      placeholder="Product name"
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  )}
                </div>

                {/* Price */}
                <div className="w-40 flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-slate-400">Unit Price (USD)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                    <input type="number" min="0" step="0.01" value={entry.unitPriceUsd}
                      onChange={e => setEntry(idx, { unitPriceUsd: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-6 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {/* Live customer currency preview */}
                  {hasFx && entry.unitPriceUsd > 0 && (
                    <span className="text-[10px] text-blue-600 font-medium">
                      = A${(entry.unitPriceUsd * draft.customFxRate!).toFixed(2)}
                    </span>
                  )}
                  {!hasFx && showSecondary && entry.unitPriceUsd > 0 && (
                    <span className="text-[10px] text-slate-400">{fmtAud(entry.unitPriceUsd)}</span>
                  )}
                </div>

                {/* Remove */}
                <button type="button" onClick={() => onRemoveEntry(idx)}
                  className="self-end mb-0.5 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>

              {/* Freight */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={entry.freightIncluded}
                  onChange={e => setEntry(idx, { freightIncluded: e.target.checked })}
                  className="rounded border-slate-300" />
                <span className="text-xs text-slate-600">Freight included</span>
              </label>

              {/* Special terms */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-400">Special Terms</label>
                  <button type="button" onClick={() => addTerm(idx)}
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold">+ Add Term</button>
                </div>
                {(entry.specialTerms ?? []).map((term, ti) => (
                  <div key={ti} className="flex gap-1 items-center">
                    <span className="text-slate-300 text-xs flex-shrink-0">•</span>
                    <input value={term} onChange={e => setTerm(idx, ti, e.target.value)}
                      placeholder={`Term ${ti + 1}…`}
                      className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
                    <button type="button" onClick={() => removeTerm(idx, ti)}
                      className="text-slate-300 hover:text-red-500 p-1 rounded transition-colors flex-shrink-0">
                      <svg width="10" height="10" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                ))}
                {(entry.specialTerms ?? []).length === 0 && (
                  <p className="text-[11px] text-slate-300 italic">None — click + Add Term</p>
                )}
              </div>

              {/* Per-entry uplift override */}
              {draft.defaultUplift?.type !== 'none' && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-semibold text-slate-400 flex-shrink-0">Override uplift:</label>
                  <select value={entry.uplift?.type ?? ''}
                    onChange={e => {
                      const t = e.target.value as UpliftType | ''
                      if (t === '') setEntry(idx, { uplift: undefined })
                      else setEntry(idx, { uplift: { type: t, percentage: entry.uplift?.percentage ?? 0, applyAnnually: false } })
                    }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Use default</option>
                    <option value="none">None (no uplift)</option>
                    <option value="cpi">CPI</option>
                    <option value="fixed">Fixed %</option>
                  </select>
                  {entry.uplift && entry.uplift.type !== 'none' && (
                    <div className="relative w-24">
                      <input type="number" min="0" step="0.01" value={entry.uplift.percentage}
                        onChange={e => setEntry(idx, { uplift: { ...entry.uplift!, percentage: parseFloat(e.target.value) || 0 } })}
                        className="w-full pr-5 pl-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400" />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">%</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {draft.entries.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">No products yet — click + Add Product</p>
          )}
        </div>

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  )
}
