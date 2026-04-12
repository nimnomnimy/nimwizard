import { useState, useMemo } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useCurrency } from '../store/useCurrency'
import { uid } from '../lib/utils'
import CurrencyBar from '../components/ui/CurrencyBar'
import { useResizable } from '../hooks/useResizable'
import type { Pricebook, PricebookEntry, UpliftConfig, UpliftType } from '../types'

function emptyUplift(): UpliftConfig {
  return { type: 'none', percentage: 0, applyAnnually: false }
}

function emptyEntry(): PricebookEntry {
  return { id: uid(), productId: '', productName: '', unitPriceUsd: 0, freightIncluded: false, specialTerms: [] }
}

function emptyPricebook(): Omit<Pricebook, 'id' | 'createdAt' | 'updatedAt'> {
  return { customerName: '', customFxRate: undefined, notes: '', validFrom: '', validTo: '', entries: [emptyEntry()], defaultUplift: emptyUplift() }
}

// Returns 'active' | 'upcoming' | 'expired' | 'no-dates'
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
  if (s === 'active')   return { label: 'Active', cls: 'bg-green-100 text-green-700 border-green-200' }
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

// Format a price in customer currency using the pricebook's custom FX rate.
// If no custom rate, falls back to the global formatter.
function fmtCustomer(
  usd: number,
  customFxRate: number | undefined,
  globalFmt: (n: number) => string,
): { primary: string; label: string } {
  if (customFxRate) {
    const aud = usd * customFxRate
    return { primary: `A$${aud.toFixed(2)}`, label: `@ ${customFxRate.toFixed(4)}` }
  }
  return { primary: globalFmt(usd), label: '' }
}

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
  const [activeId, setActiveId]   = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [draft, setDraft]         = useState(emptyPricebook())
  const [editId, setEditId]       = useState<string | null>(null)
  const [search, setSearch]       = useState('')
  const [fxInput, setFxInput]     = useState('')
  const [useFx, setUseFx]         = useState(false)
  // Left panel: grouped by customer vs flat list
  const [groupByCustomer, setGroupByCustomer] = useState(true)
  // Which customer groups are expanded in the left pane
  const [expandedCustomers, setExpandedCustomers] = useState<Set<string>>(new Set())

  const filtered = useMemo(() =>
    [...pricebooks]
      .filter(p => p.customerName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.customerName.localeCompare(b.customerName) || b.createdAt - a.createdAt),
    [pricebooks, search]
  )

  // Group by customer name
  const customerGroups = useMemo(() => {
    const map = new Map<string, Pricebook[]>()
    for (const p of filtered) {
      const key = p.customerName.trim() || '(No Name)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  const active = pricebooks.find(p => p.id === activeId) ?? null

  function toggleCustomerExpand(name: string) {
    setExpandedCustomers(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function openNew() {
    setEditId(null)
    setDraft(emptyPricebook())
    setFxInput('')
    setUseFx(false)
    setShowModal(true)
  }

  function openEdit(p: Pricebook) {
    setEditId(p.id)
    setDraft({
      customerName: p.customerName,
      customFxRate: p.customFxRate,
      notes: p.notes ?? '',
      validFrom: p.validFrom ?? '',
      validTo: p.validTo ?? '',
      entries: p.entries.map(e => ({ ...e, specialTerms: e.specialTerms ?? [] })),
      defaultUplift: p.defaultUplift ? { ...p.defaultUplift } : emptyUplift(),
    })
    setFxInput(p.customFxRate?.toString() ?? '')
    setUseFx(p.customFxRate != null)
    setShowModal(true)
  }

  function save() {
    if (!draft.customerName.trim()) return
    const ts = Date.now()
    const payload = {
      ...draft,
      customFxRate: useFx ? (parseFloat(fxInput) || undefined) : undefined,
      defaultUplift: draft.defaultUplift?.type === 'none' ? undefined : draft.defaultUplift,
      validFrom: draft.validFrom?.trim() || undefined,
      validTo: draft.validTo?.trim() || undefined,
    }
    if (editId) {
      updatePricebook({ id: editId, ...payload, createdAt: pricebooks.find(p => p.id === editId)!.createdAt, updatedAt: ts })
    } else {
      const id = uid()
      addPricebook({ id, ...payload, createdAt: ts, updatedAt: ts })
      setActiveId(id)
    }
    setShowModal(false)
  }

  function setEntry(idx: number, patch: Partial<PricebookEntry>) {
    setDraft(d => ({ ...d, entries: d.entries.map((e, i) => i === idx ? { ...e, ...patch } : e) }))
  }

  function handleProductSelect(idx: number, productId: string) {
    const p = products.find(x => x.id === productId)
    setEntry(idx, {
      productId,
      productName: p?.name ?? '',
      unitPriceUsd: p?.defaultSellPrice ?? 0,
    })
  }

  function setDefaultUplift(patch: Partial<UpliftConfig>) {
    setDraft(d => ({ ...d, defaultUplift: { ...(d.defaultUplift ?? emptyUplift()), ...patch } }))
  }

  // Special terms helpers for modal
  function addTerm(idx: number) {
    const terms = [...(draft.entries[idx].specialTerms ?? []), '']
    setEntry(idx, { specialTerms: terms })
  }
  function setTerm(entryIdx: number, termIdx: number, value: string) {
    const terms = [...(draft.entries[entryIdx].specialTerms ?? [])]
    terms[termIdx] = value
    setEntry(entryIdx, { specialTerms: terms })
  }
  function removeTerm(entryIdx: number, termIdx: number) {
    const terms = (draft.entries[entryIdx].specialTerms ?? []).filter((_, i) => i !== termIdx)
    setEntry(entryIdx, { specialTerms: terms })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 flex items-center gap-3 flex-wrap" style={{ minHeight: 52 }}>
        <h2 className="text-sm font-bold text-slate-700 flex-shrink-0">Pricebooks</h2>
        <CurrencyBar />
        <button onClick={openNew}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors flex-shrink-0">
          + New Pricebook
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden select-none">
      {/* Left pane */}
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
          {/* Group toggle */}
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
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
              <p className="text-xs text-center">No pricebooks yet.<br/>Click + New Pricebook above.</p>
            </div>
          )}

          {groupByCustomer ? (
            // ── Grouped by customer ──────────────────────────────────────────
            customerGroups.map(([customerName, books]) => {
              const isExpanded = expandedCustomers.has(customerName) || books.some(b => b.id === activeId)
              const hasActive  = books.some(b => b.id === activeId)
              return (
                <div key={customerName}>
                  {/* Customer heading */}
                  <button
                    onClick={() => toggleCustomerExpand(customerName)}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      hasActive ? 'text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}>
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
                      className={`flex-shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`}>
                      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="text-xs font-bold truncate flex-1">{customerName}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{books.length}</span>
                  </button>

                  {/* Pricebooks under this customer */}
                  {isExpanded && books.map(p => {
                    const badge = validityBadge(p)
                    return (
                    <button key={p.id} onClick={() => setActiveId(p.id)}
                      className={`w-full text-left pl-5 pr-3 py-1.5 rounded-lg text-sm transition-colors ${activeId === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-semibold text-slate-700 truncate flex-1">
                          {p.notes?.trim() ? p.notes.trim() : `${p.entries.length} product${p.entries.length !== 1 ? 's' : ''}`}
                        </p>
                        {badge && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {(p.validFrom || p.validTo) && (
                          <span className="text-[11px] text-slate-400">
                            {p.validFrom ? formatDate(p.validFrom) : '∞'} – {p.validTo ? formatDate(p.validTo) : '∞'}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {p.entries.length} item{p.entries.length !== 1 ? 's' : ''}
                          {p.customFxRate ? ` · ${p.customFxRate.toFixed(4)}` : ''}
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
            })
          ) : (
            // ── Flat list ────────────────────────────────────────────────────
            filtered.map(p => {
              const badge = validityBadge(p)
              return (
              <button key={p.id} onClick={() => setActiveId(p.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${activeId === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                <div className="flex items-center justify-between gap-1">
                  <p className="font-semibold text-slate-800 truncate text-xs flex-1">{p.customerName}</p>
                  {badge && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
                  )}
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
            })
          )}
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

      {/* Right pane — detail */}
      <div className="flex-1 overflow-y-auto">
        {!active ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-400 text-sm">Select a pricebook or create a new one</p>
          </div>
        ) : (
          <div className="max-w-5xl mx-auto p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h1 className="text-xl font-bold text-slate-900">{active.customerName}</h1>
                  {(() => { const b = validityBadge(active); return b ? <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${b.cls}`}>{b.label}</span> : null })()}
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {(active.validFrom || active.validTo) && (
                    <span className="text-xs text-slate-600 font-medium">
                      Valid: {active.validFrom ? formatDate(active.validFrom) : '—'} → {active.validTo ? formatDate(active.validTo) : 'ongoing'}
                    </span>
                  )}
                  {active.customFxRate && (
                    <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded-full border border-blue-100">
                      Custom FX: 1 USD = {active.customFxRate.toFixed(4)} AUD
                    </span>
                  )}
                  {active.defaultUplift && active.defaultUplift.type !== 'none' && (
                    <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-2 py-0.5 rounded-full border border-amber-100">
                      {upliftLabel(active.defaultUplift)}
                    </span>
                  )}
                  {active.notes && <p className="text-sm text-slate-500">{active.notes}</p>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(active)}
                  className="text-xs border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold text-slate-600 transition-colors">
                  Edit
                </button>
                <button onClick={() => { if (confirm('Delete this pricebook?')) { deletePricebook(active.id); setActiveId(null) } }}
                  className="text-xs border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg font-semibold text-red-500 transition-colors">
                  Delete
                </button>
              </div>
            </div>

            {/* Entries table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-right">Base (USD)</th>
                    {active.customFxRate && (
                      <th className="px-4 py-3 text-right text-blue-600">Customer Price</th>
                    )}
                    {!active.customFxRate && showSecondary && (
                      <th className="px-4 py-3 text-right text-slate-400">AUD</th>
                    )}
                    {active.defaultUplift && active.defaultUplift.type !== 'none' && (
                      <th className="px-4 py-3 text-right text-amber-600">After Uplift</th>
                    )}
                    <th className="px-4 py-3 text-center w-24">Freight</th>
                    <th className="px-4 py-3 text-left">Special Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {active.entries.map(entry => {
                    const effectiveUplift = entry.uplift ?? active.defaultUplift
                    const uplifted = applyUplift(entry.unitPriceUsd, effectiveUplift)
                    const hasUplift = active.defaultUplift && active.defaultUplift.type !== 'none'
                    const hasCustomFx = !!active.customFxRate
                    const { primary: custPrice, label: fxLabel } = fmtCustomer(entry.unitPriceUsd, active.customFxRate, fmt)
                    const custUplifted = hasCustomFx && active.customFxRate
                      ? `A$${(uplifted * active.customFxRate).toFixed(2)}`
                      : fmt(uplifted)
                    const terms = entry.specialTerms ?? []

                    return (
                      <tr key={entry.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{entry.productName || '—'}</p>
                          {entry.uplift && entry.uplift.type !== 'none' && (
                            <p className="text-[10px] text-amber-600 mt-0.5">{upliftLabel(entry.uplift)} (override)</p>
                          )}
                        </td>

                        {/* Base USD price */}
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-slate-700">{fmt(entry.unitPriceUsd)}</span>
                        </td>

                        {/* Customer currency column (only when custom FX is set) */}
                        {hasCustomFx && (
                          <td className="px-4 py-3 text-right">
                            <span className="font-semibold text-blue-700">{custPrice}</span>
                            {fxLabel && <p className="text-[10px] text-blue-400 mt-0.5">{fxLabel}</p>}
                          </td>
                        )}

                        {/* AUD column (only when no custom FX and showSecondary) */}
                        {!hasCustomFx && showSecondary && (
                          <td className="px-4 py-3 text-right">
                            <span className="font-semibold text-slate-400">{fmtAud(entry.unitPriceUsd)}</span>
                          </td>
                        )}

                        {/* After uplift column */}
                        {hasUplift && (
                          <td className="px-4 py-3 text-right">
                            <span className="font-semibold text-amber-700">{hasCustomFx ? custUplifted : fmt(uplifted)}</span>
                            {!hasCustomFx && showSecondary && (
                              <p className="text-[10px] text-amber-400">{fmtAud(uplifted)}</p>
                            )}
                          </td>
                        )}

                        {/* Freight */}
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${entry.freightIncluded ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {entry.freightIncluded ? 'Included' : 'Excluded'}
                          </span>
                        </td>

                        {/* Special terms — multi-line */}
                        <td className="px-4 py-3">
                          {terms.length === 0 ? (
                            <span className="text-xs text-slate-300">—</span>
                          ) : (
                            <ul className="flex flex-col gap-0.5">
                              {terms.filter(t => t.trim()).map((t, i) => (
                                <li key={i} className="text-xs text-slate-600 flex items-start gap-1">
                                  <span className="text-slate-300 flex-shrink-0 mt-0.5">•</span>
                                  <span>{t}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-400">
              {active.entries.length} product{active.entries.length !== 1 ? 's' : ''} ·
              Updated {new Date(active.updatedAt).toLocaleDateString('en-AU')}
            </div>
          </div>
        )}
      </div>{/* end right pane */}
      </div>{/* end panel row */}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[5vh] px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-slate-900">{editId ? 'Edit Pricebook' : 'New Pricebook'}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {/* Customer name */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">Customer Name</label>
                <input value={draft.customerName} onChange={e => setDraft(d => ({ ...d, customerName: e.target.value }))}
                  placeholder="Acme Corporation"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              {/* FX Rate */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button type="button" role="switch" aria-checked={useFx}
                    onClick={() => setUseFx(v => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${useFx ? 'bg-blue-500' : 'bg-slate-200'}`}>
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${useFx ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="text-sm font-medium text-slate-700">Custom FX rate (USD→AUD)</span>
                </div>
                {useFx && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">1 USD =</span>
                    <input type="number" step="0.0001" value={fxInput}
                      onChange={e => setFxInput(e.target.value)}
                      placeholder="e.g. 1.5800"
                      className="w-32 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <span className="text-xs text-slate-500">AUD</span>
                    {fxInput && parseFloat(fxInput) > 0 && (
                      <span className="text-[11px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                        A$1 = {(1 / parseFloat(fxInput)).toFixed(4)} USD
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Default Uplift / CPI */}
              <div className="flex flex-col gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Default Price Uplift</p>
                <div className="flex gap-2 flex-wrap">
                  {(['none', 'cpi', 'fixed'] as UpliftType[]).map(t => (
                    <button key={t} type="button"
                      onClick={() => setDefaultUplift({ type: t })}
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

              {/* Validity window */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-500">Validity Period</label>
                <div className="flex gap-3 items-center flex-wrap">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-slate-400">Valid From</label>
                    <input type="date"
                      value={draft.validFrom ?? ''}
                      onChange={e => setDraft(d => ({ ...d, validFrom: e.target.value }))}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <span className="text-slate-400 text-sm mt-4">→</span>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-slate-400">Valid To</label>
                    <input type="date"
                      value={draft.validTo ?? ''}
                      onChange={e => setDraft(d => ({ ...d, validTo: e.target.value }))}
                      min={draft.validFrom ?? undefined}
                      className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  {(draft.validFrom || draft.validTo) && (
                    <button onClick={() => setDraft(d => ({ ...d, validFrom: '', validTo: '' }))}
                      className="text-[11px] text-slate-400 hover:text-red-500 mt-4 transition-colors">
                      Clear dates
                    </button>
                  )}
                </div>
                {draft.validFrom && draft.validTo && draft.validFrom > draft.validTo && (
                  <p className="text-xs text-red-500">Valid From must be before Valid To.</p>
                )}
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">Notes</label>
                <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                  rows={2} placeholder="Optional notes…"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              {/* Entries */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500">Products</label>
                  <button onClick={() => setDraft(d => ({ ...d, entries: [...d.entries, emptyEntry()] }))}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold">+ Add Product</button>
                </div>

                {draft.entries.map((entry, idx) => (
                  <div key={entry.id} className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex gap-2 items-start">
                      {/* Product selector */}
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400">Product</label>
                        {products.length > 0 ? (
                          <select value={entry.productId}
                            onChange={e => handleProductSelect(idx, e.target.value)}
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">— Select —</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : (
                          <input value={entry.productName}
                            onChange={e => setEntry(idx, { productName: e.target.value })}
                            placeholder="Product name"
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        )}
                      </div>

                      {/* Price */}
                      <div className="w-36 flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400">Unit Price (USD)</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                          <input type="number" min="0" step="0.01" value={entry.unitPriceUsd}
                            onChange={e => setEntry(idx, { unitPriceUsd: parseFloat(e.target.value) || 0 })}
                            className="w-full pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        {/* Live customer currency preview */}
                        {useFx && fxInput && parseFloat(fxInput) > 0 && entry.unitPriceUsd > 0 && (
                          <span className="text-[10px] text-blue-600">
                            = A${(entry.unitPriceUsd * parseFloat(fxInput)).toFixed(2)}
                          </span>
                        )}
                      </div>

                      {/* Remove */}
                      <button onClick={() => setDraft(d => ({ ...d, entries: d.entries.filter((_, i) => i !== idx) }))}
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

                    {/* Special terms — multi-row */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-slate-400">Special Terms</label>
                        <button onClick={() => addTerm(idx)}
                          className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold">+ Add Term</button>
                      </div>
                      {(entry.specialTerms ?? []).map((term, ti) => (
                        <div key={ti} className="flex gap-1 items-center">
                          <span className="text-slate-300 text-xs flex-shrink-0">•</span>
                          <input
                            value={term}
                            onChange={e => setTerm(idx, ti, e.target.value)}
                            placeholder={`Term ${ti + 1}…`}
                            className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                          <button onClick={() => removeTerm(idx, ti)}
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
                        <select
                          value={entry.uplift?.type ?? ''}
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
                            <input type="number" min="0" step="0.01"
                              value={entry.uplift.percentage}
                              onChange={e => setEntry(idx, { uplift: { ...entry.uplift!, percentage: parseFloat(e.target.value) || 0 } })}
                              className="w-full pr-5 pl-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-400" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[10px]">%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 flex-shrink-0">
              <button onClick={() => setShowModal(false)}
                className="text-sm border border-slate-200 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={save} disabled={!draft.customerName.trim()}
                className="text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg font-semibold transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
