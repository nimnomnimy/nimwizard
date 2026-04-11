import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useCurrency } from '../store/useCurrency'
import { uid } from '../lib/utils'
import CurrencyBar from '../components/ui/CurrencyBar'
import type { Pricebook, PricebookEntry } from '../types'

function emptyEntry(): PricebookEntry {
  return { id: uid(), productId: '', productName: '', unitPriceUsd: 0, freightIncluded: false }
}

function emptyPricebook(): Omit<Pricebook, 'id' | 'createdAt' | 'updatedAt'> {
  return { customerName: '', customFxRate: undefined, notes: '', entries: [emptyEntry()] }
}

export default function PricebookPage() {
  const pricebooks      = useAppStore(s => s.pricebooks)
  const products        = useAppStore(s => s.dealProducts)
  const addPricebook    = useAppStore(s => s.addPricebook)
  const updatePricebook = useAppStore(s => s.updatePricebook)
  const deletePricebook = useAppStore(s => s.deletePricebook)
  const fmt             = useCurrency(s => s.fmt)
  const currency        = useCurrency(s => s.currency)

  const [activeId, setActiveId]   = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [draft, setDraft]         = useState(emptyPricebook())
  const [editId, setEditId]       = useState<string | null>(null)
  const [search, setSearch]       = useState('')
  const [fxInput, setFxInput]     = useState('')
  const [useFx, setUseFx]         = useState(false)

  const sorted = [...pricebooks]
    .filter(p => p.customerName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt)

  const active = pricebooks.find(p => p.id === activeId) ?? null

  function openNew() {
    setEditId(null)
    setDraft(emptyPricebook())
    setFxInput('')
    setUseFx(false)
    setShowModal(true)
  }

  function openEdit(p: Pricebook) {
    setEditId(p.id)
    setDraft({ customerName: p.customerName, customFxRate: p.customFxRate, notes: p.notes ?? '', entries: p.entries.map(e => ({ ...e })) })
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

  // Compute AUD price for display
  function toAud(usdPrice: number, entry: PricebookEntry, pb: Pricebook): number {
    const rate = entry.customFxRate ?? pb.customFxRate ?? 1
    return usdPrice * rate
  }

  return (
    <div className="flex h-full overflow-hidden bg-slate-100">

      {/* Left pane */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold text-slate-800 text-sm flex-shrink-0">Pricebooks</h2>
            <CurrencyBar />
            <button onClick={openNew}
              className="flex items-center gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded-lg font-semibold transition-colors flex-shrink-0">
              + New
            </button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {sorted.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">No pricebooks yet</p>
          )}
          {sorted.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${activeId === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
              <p className="font-semibold text-slate-800 truncate">{p.customerName}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {p.entries.length} product{p.entries.length !== 1 ? 's' : ''}
                {p.customFxRate ? ` · FX ${p.customFxRate.toFixed(4)}` : ''}
              </p>
            </button>
          ))}
        </div>
      </div>

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
                <h1 className="text-xl font-bold text-slate-900">{active.customerName}</h1>
                <div className="flex items-center gap-3 mt-1">
                  {active.customFxRate && (
                    <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded-full">
                      FX rate: {active.customFxRate.toFixed(4)} USD→AUD
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
                    <th className="px-4 py-3 text-right">Unit Price</th>
                    {currency === 'USD' && (active.customFxRate != null) && <th className="px-4 py-3 text-right">AUD</th>}
                    <th className="px-4 py-3 text-center w-28">Freight</th>
                    <th className="px-4 py-3 text-left">Special Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {active.entries.map(entry => (
                    <tr key={entry.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{entry.productName || '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">
                        {fmt(entry.unitPriceUsd)}
                      </td>
                      {currency === 'USD' && (active.customFxRate != null) && (
                        <td className="px-4 py-3 text-right text-slate-500">
                          A${toAud(entry.unitPriceUsd, entry, active).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      )}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${entry.freightIncluded ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {entry.freightIncluded ? 'Included' : 'Excluded'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{entry.specialTerms || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-400">
              {active.entries.length} product{active.entries.length !== 1 ? 's' : ''} ·
              Updated {new Date(active.updatedAt).toLocaleDateString('en-AU')}
            </div>
          </div>
        )}
      </div>

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
                  <input type="number" step="0.0001" value={fxInput}
                    onChange={e => setFxInput(e.target.value)}
                    placeholder="e.g. 1.5800"
                    className="w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
                      {/* Product */}
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
                      <div className="w-32 flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400">Unit Price (USD)</label>
                        <div className="relative">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                          <input type="number" min="0" step="0.01" value={entry.unitPriceUsd}
                            onChange={e => setEntry(idx, { unitPriceUsd: parseFloat(e.target.value) || 0 })}
                            className="w-full pl-5 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                      </div>
                      {/* Remove */}
                      <button onClick={() => setDraft(d => ({ ...d, entries: d.entries.filter((_, i) => i !== idx) }))}
                        className="self-end mb-0.5 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </div>

                    {/* Freight + Special Terms row */}
                    <div className="flex gap-3 items-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={entry.freightIncluded}
                          onChange={e => setEntry(idx, { freightIncluded: e.target.checked })}
                          className="rounded border-slate-300" />
                        <span className="text-xs text-slate-600">Freight included</span>
                      </label>
                      <input value={entry.specialTerms ?? ''}
                        onChange={e => setEntry(idx, { specialTerms: e.target.value })}
                        placeholder="Special terms…"
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
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
