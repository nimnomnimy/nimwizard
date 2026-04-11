import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { uid } from '../lib/utils'
import type { CustomerConfig, CustomerConfigItem } from '../types'

const now = () => Date.now()

function emptyItem(): CustomerConfigItem {
  return { id: uid(), productId: '', productName: '', description: '', quantity: 1 }
}

function emptyConfig(): Omit<CustomerConfig, 'id' | 'createdAt' | 'updatedAt'> {
  return { customerName: '', notes: '', items: [emptyItem()] }
}

export default function CustomerConfigsPage() {
  const configs      = useAppStore(s => s.customerConfigs)
  const products     = useAppStore(s => s.dealProducts)
  const addConfig    = useAppStore(s => s.addCustomerConfig)
  const updateConfig = useAppStore(s => s.updateCustomerConfig)
  const deleteConfig = useAppStore(s => s.deleteCustomerConfig)

  const [activeId, setActiveId]   = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [draft, setDraft]         = useState(emptyConfig())
  const [editId, setEditId]       = useState<string | null>(null)
  const [search, setSearch]       = useState('')

  const sorted = [...configs]
    .filter(c => c.customerName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.createdAt - a.createdAt)

  const activeConfig = configs.find(c => c.id === activeId) ?? null

  function openNew() {
    setEditId(null)
    setDraft(emptyConfig())
    setShowModal(true)
  }

  function openEdit(c: CustomerConfig) {
    setEditId(c.id)
    setDraft({ customerName: c.customerName, notes: c.notes ?? '', items: c.items.map(i => ({ ...i })) })
    setShowModal(true)
  }

  function save() {
    if (!draft.customerName.trim()) return
    const ts = now()
    if (editId) {
      updateConfig({ id: editId, ...draft, createdAt: configs.find(c => c.id === editId)!.createdAt, updatedAt: ts })
    } else {
      const id = uid()
      addConfig({ id, ...draft, createdAt: ts, updatedAt: ts })
      setActiveId(id)
    }
    setShowModal(false)
  }

  function setItem(idx: number, patch: Partial<CustomerConfigItem>) {
    setDraft(d => {
      const items = d.items.map((it, i) => i === idx ? { ...it, ...patch } : it)
      return { ...d, items }
    })
  }

  function handleProductSelect(idx: number, productId: string) {
    const p = products.find(x => x.id === productId)
    setItem(idx, { productId, productName: p?.name ?? '' })
  }

  function addItem() {
    setDraft(d => ({ ...d, items: [...d.items, emptyItem()] }))
  }

  function removeItem(idx: number) {
    setDraft(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }))
  }

  return (
    <div className="flex h-full overflow-hidden bg-slate-100">

      {/* Left pane — list */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 text-sm">Customer Configs</h2>
            <button onClick={openNew}
              className="flex items-center gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded-lg font-semibold transition-colors">
              + New
            </button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {sorted.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-8">No configs yet</p>
          )}
          {sorted.map(c => (
            <button key={c.id} onClick={() => setActiveId(c.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-colors ${activeId === c.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
              <p className="font-semibold text-slate-800 truncate">{c.customerName}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{c.items.length} item{c.items.length !== 1 ? 's' : ''}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Right pane — detail */}
      <div className="flex-1 overflow-y-auto">
        {!activeConfig ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-slate-400 text-sm">Select a config or create a new one</p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-bold text-slate-900">{activeConfig.customerName}</h1>
                {activeConfig.notes && <p className="text-sm text-slate-500 mt-1">{activeConfig.notes}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(activeConfig)}
                  className="text-xs border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold text-slate-600 transition-colors">
                  Edit
                </button>
                <button onClick={() => { if (confirm('Delete this config?')) { deleteConfig(activeConfig.id); setActiveId(null) } }}
                  className="text-xs border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg font-semibold text-red-500 transition-colors">
                  Delete
                </button>
              </div>
            </div>

            {/* Items table */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-right w-20">Qty</th>
                    <th className="px-4 py-3 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConfig.items.map(item => (
                    <tr key={item.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{item.productName || item.productId || '—'}</p>
                        {item.productId && item.productName !== item.productId && (
                          <p className="text-[11px] text-slate-400">{item.productId.slice(0, 8)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{item.description || '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">{item.quantity}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{item.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary */}
            <div className="text-xs text-slate-400">
              {activeConfig.items.length} item{activeConfig.items.length !== 1 ? 's' : ''} ·
              Total qty: {activeConfig.items.reduce((s, i) => s + i.quantity, 0)} ·
              Updated {new Date(activeConfig.updatedAt).toLocaleDateString('en-AU')}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-[5vh] px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-slate-900">{editId ? 'Edit Config' : 'New Config'}</h3>
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

              {/* Notes */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-500">Notes</label>
                <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                  rows={2} placeholder="Optional notes…"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>

              {/* Items */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500">Items</label>
                  <button onClick={addItem}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold">+ Add Item</button>
                </div>

                {draft.items.map((item, idx) => (
                  <div key={item.id} className="bg-slate-50 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      {/* Product select */}
                      <div className="flex-1 flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400">Product</label>
                        {products.length > 0 ? (
                          <select value={item.productId}
                            onChange={e => handleProductSelect(idx, e.target.value)}
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <option value="">— Select or type below —</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        ) : (
                          <input value={item.productName}
                            onChange={e => setItem(idx, { productName: e.target.value })}
                            placeholder="Product name"
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        )}
                        {products.length > 0 && (
                          <input value={item.productName}
                            onChange={e => setItem(idx, { productName: e.target.value })}
                            placeholder="Override display name…"
                            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        )}
                      </div>
                      {/* Qty */}
                      <div className="w-20 flex flex-col gap-1">
                        <label className="text-[11px] font-semibold text-slate-400">Qty</label>
                        <input type="number" min="1" value={item.quantity}
                          onChange={e => setItem(idx, { quantity: parseInt(e.target.value) || 1 })}
                          className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      {/* Remove */}
                      <button onClick={() => removeItem(idx)}
                        className="self-end mb-0.5 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                    {/* Description */}
                    <input value={item.description}
                      onChange={e => setItem(idx, { description: e.target.value })}
                      placeholder="Description / feature detail…"
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    {/* Notes */}
                    <input value={item.notes ?? ''}
                      onChange={e => setItem(idx, { notes: e.target.value })}
                      placeholder="Notes (optional)…"
                      className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
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
