import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useCurrency } from '../store/useCurrency'
import { uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import CurrencyBar from '../components/ui/CurrencyBar'
import ProductConfigEditor from '../components/products/ProductConfigEditor'
import { useResizable } from '../hooks/useResizable'
import {
  exportProductsJSON, exportProductsXLSX, exportProductConfigXLSX, importProductsJSON,
} from '../lib/exportUtils'
import type {
  DealProduct, PriceHistoryEntry, ProductCategory, ProductConfiguration, ConfigGroup,
  PricingType, RecurringPeriod,
} from '../types'

const CATEGORY_COLORS: Record<ProductCategory, string> = {
  'Software':              'bg-blue-100 text-blue-700',
  'Hardware':              'bg-slate-100 text-slate-700',
  'Professional Services': 'bg-purple-100 text-purple-700',
  'Technical Services':    'bg-sky-100 text-sky-700',
  'Maintenance':           'bg-green-100 text-green-700',
}

const CATEGORIES: ProductCategory[] = [
  'Software', 'Hardware', 'Professional Services', 'Technical Services', 'Maintenance',
]

// ─── Price calculation from configs ──────────────────────────────────────────

// Subtotal for a group: net × rowQty × term, with sub-group qty applied
function groupFieldSubtotal(g: ConfigGroup, field: 'cost' | 'floor' | 'sell'): number {
  if (!g?.children) return 0
  const isRecurring = g.pricingType === 'recurring'
  return g.children.reduce((s, c) => {
    if (c.type === 'row') {
      const basePrice = field === 'cost' ? c.row.costPriceUsd : field === 'floor' ? c.row.floorPriceUsd : c.row.sellPriceUsd
      const price = field === 'sell' ? (basePrice ?? 0) * (1 - (c.row.discountPct ?? 0) / 100) : (basePrice ?? 0)
      return s + price * (c.row.quantity ?? 1) * (isRecurring ? (c.row.termMonths ?? 1) : 1)
    }
    if (c.type === 'subgroup') return s + groupFieldSubtotal(c.group, field) * (c.group.qty ?? 1)
    return s
  }, 0)
}

function groupFieldTotal(g: ConfigGroup, field: 'cost' | 'floor' | 'sell'): number {
  return groupFieldSubtotal(g, field) * (g.qty ?? 1)
}

function configsTotal(configs: ProductConfiguration[], field: 'cost' | 'floor' | 'sell'): number {
  if (!configs?.length) return 0
  return configs.reduce((s, cfg) => s + (cfg.groups ?? []).reduce((gs, g) => gs + groupFieldTotal(g, field), 0), 0)
}

// Matches the config editor footer: net × qty × term × groupQty — same as groupFieldTotal(g, 'sell')
function configsNetQtyTotal(configs: ProductConfiguration[]): number {
  return configsTotal(configs, 'sell')
}

// ─── Form state ───────────────────────────────────────────────────────────────

type FormState = {
  name: string
  category: ProductCategory
  pricingType: PricingType
  costPrice: string
  floorSellPrice: string
  defaultSellPrice: string
  recurringPeriod: RecurringPeriod
  recurringTermMonths: number
  recurringPricePerPeriod: string
  recurringFloorPricePerPeriod: string
  recurringCostPrice: string
}

function emptyForm(): FormState {
  return {
    name: '',
    category: 'Software',
    pricingType: 'one-time',
    costPrice: '',
    floorSellPrice: '',
    defaultSellPrice: '',
    recurringPeriod: 'monthly',
    recurringTermMonths: 36,
    recurringPricePerPeriod: '',
    recurringFloorPricePerPeriod: '',
    recurringCostPrice: '',
  }
}

function productToForm(p: DealProduct): FormState {
  const rc = p.recurringConfig
  return {
    name: p.name,
    category: p.category,
    pricingType: p.pricingType ?? 'one-time',
    costPrice: p.costPrice ? String(p.costPrice) : '',
    floorSellPrice: p.floorSellPrice ? String(p.floorSellPrice) : '',
    defaultSellPrice: p.pricingType === 'one-time' && p.defaultSellPrice ? String(p.defaultSellPrice) : '',
    recurringPeriod: rc?.period ?? 'monthly',
    recurringTermMonths: rc?.termMonths ?? 36,
    recurringPricePerPeriod: rc?.pricePerPeriod ? String(rc.pricePerPeriod) : '',
    recurringFloorPricePerPeriod: rc?.floorPricePerPeriod ? String(rc.floorPricePerPeriod) : '',
    recurringCostPrice: p.pricingType === 'recurring' && p.costPrice ? String(p.costPrice) : '',
  }
}

function parsePrice(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const products      = useAppStore(s => s.dealProducts)
  const addProduct    = useAppStore(s => s.addDealProduct)
  const updateProduct = useAppStore(s => s.updateDealProduct)
  const deleteProduct = useAppStore(s => s.deleteDealProduct)
  const saveFxRate    = useAppStore(s => s.saveFxRate)
  const fmt           = useCurrency(s => s.fmt)
  const fmtAud        = useCurrency(s => s.fmtAud)
  const showSecondary = useCurrency(s => s.showSecondary)

  // null = new product form, string = existing product, undefined = nothing selected
  const [activeId, setActiveId]     = useState<string | null | undefined>(undefined)
  const [search, setSearch]         = useState('')
  const [filterCat, setFilterCat]   = useState<ProductCategory | 'all'>('all')
  const [filterType, setFilterType] = useState<'all' | 'one-time' | 'recurring'>('all')
  const [form, setForm]             = useState<FormState>(emptyForm())
  const [dirty, setDirty]           = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const justCreatedRef = useRef(false)
  const left = useResizable({ initial: 260, min: 180, max: 400 })
  const importRef = useRef<HTMLInputElement>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)

  const existing = typeof activeId === 'string' ? (products.find(p => p.id === activeId) ?? null) : null
  const isNew = activeId === null

  // When selection changes, load the product into the form
  useEffect(() => {
    if (activeId === null) {
      setForm(emptyForm())
      setDirty(false)
      setTimeout(() => nameRef.current?.focus(), 50)
    } else if (existing) {
      setForm(productToForm(existing))
      if (justCreatedRef.current) {
        justCreatedRef.current = false
        setDirty(true)
        setTimeout(() => nameRef.current?.select(), 50)
      } else {
        setDirty(false)
      }
    }
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
    setDirty(true)
  }

  function handleConfigsChange(productId: string, configs: ProductConfiguration[]) {
    const p = products.find(x => x.id === productId)
    if (!p) return
    updateProduct({ ...p, configurations: configs })
  }

  function handleNewProduct() {
    const newId = uid()
    const firstGroup: ConfigGroup = { id: uid(), label: 'Group 1', collapsed: false, pricingType: 'one-time', defaultUnit: 'months', children: [] }
    const firstConfig: ProductConfiguration = { id: uid(), name: 'New Product', groups: [firstGroup], currency: 'USD', createdAt: Date.now(), updatedAt: Date.now() }
    const product: DealProduct = {
      id: newId,
      name: 'New Product',
      category: 'Software',
      pricingType: 'one-time',
      costPrice: 0,
      floorSellPrice: 0,
      defaultSellPrice: 0,
      priceHistory: [],
      createdAt: Date.now(),
      configurations: [firstConfig],
    }
    justCreatedRef.current = true
    addProduct(product)
    setActiveId(newId)
  }

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = filterCat === 'all' || p.category === filterCat
    const matchType   = filterType === 'all' || p.pricingType === filterType
    return matchSearch && matchCat && matchType
  }).sort((a, b) => a.name.localeCompare(b.name))

  function priceDisplay(p: DealProduct): { primary: string; secondary?: string; sub?: string } {
    const cfgTotal = configsNetQtyTotal(p.configurations ?? [])
    if (cfgTotal > 0) {
      return {
        primary: fmt(cfgTotal),
        secondary: showSecondary ? fmtAud(cfgTotal) : undefined,
        sub: 'config total',
      }
    }
    if (p.pricingType === 'recurring' && p.recurringConfig) {
      const rc = p.recurringConfig
      const label = rc.period === 'monthly' ? '/mo' : '/yr'
      return {
        primary: `${fmt(rc.pricePerPeriod)}${label}`,
        secondary: showSecondary ? `${fmtAud(rc.pricePerPeriod)}${label}` : undefined,
        sub: `${rc.termMonths}mo term`,
      }
    }
    return {
      primary: fmt(p.defaultSellPrice),
      secondary: showSecondary ? fmtAud(p.defaultSellPrice) : undefined,
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    if (!form.name.trim()) return

    let defaultSellPrice = parsePrice(form.defaultSellPrice)
    let floorSellPrice   = parsePrice(form.floorSellPrice)
    let costPrice        = parsePrice(form.costPrice)

    if (form.pricingType === 'recurring') {
      const price = parsePrice(form.recurringPricePerPeriod)
      const floor = parsePrice(form.recurringFloorPricePerPeriod)
      costPrice = parsePrice(form.recurringCostPrice)
      const periods = form.recurringPeriod === 'monthly'
        ? form.recurringTermMonths
        : Math.ceil(form.recurringTermMonths / 12)
      defaultSellPrice = price * periods
      floorSellPrice   = floor * periods
    }

    const prevHistory: PriceHistoryEntry[] = existing?.priceHistory ?? []
    const priceChanged = !existing ||
      existing.costPrice !== costPrice ||
      existing.floorSellPrice !== floorSellPrice ||
      existing.defaultSellPrice !== defaultSellPrice
    const newHistory: PriceHistoryEntry[] = priceChanged
      ? [...prevHistory, { id: uid(), savedAt: Date.now(), costPrice, floorSellPrice, defaultSellPrice }]
      : prevHistory

    const product: DealProduct = {
      id:          existing?.id ?? uid(),
      name:        form.name.trim(),
      category:    form.category,
      pricingType: form.pricingType,
      costPrice,
      floorSellPrice,
      defaultSellPrice,
      recurringConfig: form.pricingType === 'recurring' ? {
        period:              form.recurringPeriod,
        termMonths:          form.recurringTermMonths,
        pricePerPeriod:      parsePrice(form.recurringPricePerPeriod),
        floorPricePerPeriod: parsePrice(form.recurringFloorPricePerPeriod),
      } : undefined,
      fxOverride:     existing?.fxOverride,
      priceHistory:   newHistory,
      createdAt:      existing?.createdAt ?? Date.now(),
      configurations: existing?.configurations?.map((c, i) =>
        i === 0 ? { ...c, name: form.name.trim() } : c
      ),
    }

    if (existing) {
      updateProduct(product)
      showToast(`${product.name} updated`, 'success')
    } else {
      addProduct(product)
      showToast(`${product.name} added`, 'success')
      setActiveId(product.id)
    }
    setDirty(false)
  }

  function handleClone() {
    if (!existing) return
    const newId = uid()
    const cloned: DealProduct = {
      ...existing,
      id: newId,
      name: `${existing.name} (copy)`,
      priceHistory: [],
      createdAt: Date.now(),
      configurations: (existing.configurations ?? []).map(cfg => ({
        ...cfg,
        id: uid(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
    }
    addProduct(cloned)
    setActiveId(newId)
    showToast(`Cloned as "${cloned.name}"`, 'success')
  }

  function handleDelete() {
    if (!existing) return
    if (!confirm(`Delete "${existing.name}"?`)) return
    deleteProduct(existing.id)
    showToast(`${existing.name} deleted`)
    setActiveId(undefined)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const imported = importProductsJSON(ev.target?.result as string)
        const existing = new Set(products.map(p => p.id))
        let added = 0
        for (const p of imported) {
          if (existing.has(p.id)) { updateProduct(p); added++ }
          else { addProduct(p); added++ }
        }
        showToast(`Imported ${added} product(s)`, 'success')
      } catch {
        showToast('Import failed: invalid file', 'error')
      }
    }
    reader.readAsText(file)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 flex items-center gap-3 flex-wrap" style={{ minHeight: 52 }}>
        <h2 className="text-sm font-bold text-slate-700 flex-shrink-0">Products</h2>
        <CurrencyBar onFxChange={saveFxRate} />
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {/* Import */}
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <button onClick={() => importRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6l3.5 3.5L10 6M2 11h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Import
          </button>
          {/* Export dropdown */}
          <div className="relative">
            <button onClick={() => setShowExportMenu(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold hover:bg-slate-200 transition-colors">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 9V1M3 4l3.5-3.5L10 4M2 11h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Export
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 min-w-[170px] py-1"
                onMouseLeave={() => setShowExportMenu(false)}>
                <p className="px-4 pt-1.5 pb-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide">All products</p>
                <button onClick={() => { exportProductsJSON(products); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Export JSON
                </button>
                <button onClick={() => { exportProductsXLSX(products); setShowExportMenu(false) }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Export Excel (all fields)
                </button>
                <div className="my-1 border-t border-slate-100" />
                <p className="px-4 pt-1.5 pb-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide">Config only</p>
                <button
                  onClick={() => { if (existing) { exportProductConfigXLSX(existing); setShowExportMenu(false) } }}
                  disabled={!existing}
                  title={!existing ? 'Select a product first' : undefined}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed">
                  Export Config Excel
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleNewProduct}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors">
            + New Product
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden select-none">
        {/* Left pane — list */}
        {left.isOpen ? (
          <>
          <div style={{ width: left.width }} className="flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
            <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">All Products ({products.length})</span>
                <button onClick={() => left.setIsOpen(false)} className="text-slate-300 hover:text-slate-500 p-1 rounded" title="Collapse">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              </div>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <div className="flex gap-1">
                {(['all', 'one-time', 'recurring'] as const).map(t => (
                  <button key={t} onClick={() => setFilterType(t)}
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors capitalize ${filterType === t ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {t === 'all' ? 'All' : t}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 flex-wrap">
                <button onClick={() => setFilterCat('all')}
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors ${filterCat === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  All
                </button>
                {CATEGORIES.map(c => (
                  <button key={c} onClick={() => setFilterCat(c)}
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors ${filterCat === c ? CATEGORY_COLORS[c] : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                    {c.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
              {filtered.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-8">No products match filters</p>
              )}
              {filtered.map(p => {
                const { primary, secondary, sub } = priceDisplay(p)
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors ${activeId === p.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'}`}>
                    <div className="flex items-start justify-between gap-1">
                      <p className="font-semibold text-slate-800 truncate flex-1 text-xs">{p.name}</p>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-slate-700">{primary}</p>
                        {secondary && <p className="text-[10px] text-slate-400">{secondary}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[p.category]}`}>{p.category}</span>
                      {p.pricingType === 'recurring' && (
                        <span className="text-[10px] bg-indigo-100 text-indigo-600 font-semibold px-1.5 py-0.5 rounded-full">Recurring</span>
                      )}
                      {sub && <span className="text-[10px] text-slate-400">{sub}</span>}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="p-2 border-t border-slate-100 text-xs text-slate-400 text-center">
              {filtered.length} of {products.length}
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

        {/* Right pane */}
        <div className="flex-1 overflow-y-auto bg-white">
          {activeId === undefined ? (
            /* ── Empty state ── */
            <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M16 24h16M24 16v16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <div className="text-center">
                <p className="font-semibold text-slate-600 text-sm">Select a product</p>
                <p className="text-sm mt-1">or click + New to create one</p>
              </div>
            </div>
          ) : (
            /* ── Product detail / new form — unified view ── */
            <ProductDetailPane
              key={activeId ?? '__new__'}
              productId={activeId}
              form={form}
              dirty={dirty}
              isNew={isNew}
              existing={existing}
              configs={existing?.configurations ?? []}
              set={set}
              onSave={handleSave}
              onDelete={handleDelete}
              onDeleteHistoryIds={ids => {
                if (!existing) return
                const filtered = (existing.priceHistory ?? []).filter(h => !ids.includes(h.id))
                updateProduct({ ...existing, priceHistory: filtered })
                showToast(`${ids.length} record${ids.length > 1 ? 's' : ''} deleted`)
              }}
              onConfigsChange={cfgs => existing && handleConfigsChange(existing.id, cfgs)}
              onClone={handleClone}
              nameRef={nameRef}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Unified product detail / edit pane ──────────────────────────────────────

function ProductDetailPane({
  form, dirty, isNew, existing, configs,
  set, onSave, onDelete, onDeleteHistoryIds, onConfigsChange, onClone,
  nameRef,
}: {
  productId: string | null
  form: FormState
  dirty: boolean
  isNew: boolean
  existing: DealProduct | null
  configs: ProductConfiguration[]
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  onSave: (e?: React.FormEvent) => void
  onDelete: () => void
  onClone: () => void
  onDeleteHistoryIds: (ids: string[]) => void
  onConfigsChange: (cfgs: ProductConfiguration[]) => void
  nameRef: React.RefObject<HTMLInputElement | null>
}) {
  const historyCount = existing?.priceHistory?.length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <form onSubmit={onSave} className="flex flex-col h-full">
        <ProductConfigEditor
          configs={configs}
          onChange={onConfigsChange}
          hideConfigName
          headerSlot={
            <div className="flex items-center gap-2">
              {/* Product name — grows to fill */}
              <input
                ref={nameRef}
                type="text"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="Product name…"
                required
                className="text-lg font-bold text-slate-900 bg-transparent border-0 focus:outline-none focus:bg-slate-50 rounded-lg px-2 py-0.5 flex-1 min-w-0 placeholder:text-slate-300"
              />
              {/* Save / Clone / Delete inline */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!isNew && (
                  <button type="button" onClick={onClone}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors">
                    Clone
                  </button>
                )}
                {!isNew && (
                  <button type="button" onClick={onDelete}
                    className="px-2.5 py-1 rounded-lg border border-red-200 text-red-500 text-xs font-medium hover:bg-red-50 transition-colors">
                    Delete
                  </button>
                )}
                <button
                  type="submit"
                  disabled={!dirty && !isNew}
                  className="px-3 py-1 rounded-lg bg-blue-500 text-white text-xs font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Save
                </button>
              </div>
            </div>
          }
        />

        {/* Price history — below the config card */}
        {existing && historyCount > 0 && (
          <div className="mx-4 mt-3 border border-slate-200 rounded-xl overflow-hidden">
            <PriceHistorySection
              history={existing.priceHistory!}
              onDeleteIds={onDeleteHistoryIds}
            />
          </div>
        )}
      </form>
    </div>
  )
}

// ─── Price history ────────────────────────────────────────────────────────────

type DateBucket = 'today' | 'week' | 'month' | 'year' | 'older'
function getBucket(ts: number): DateBucket {
  const diff = Date.now() - ts
  if (diff < 86_400_000)       return 'today'
  if (diff < 7  * 86_400_000)  return 'week'
  if (diff < 30 * 86_400_000)  return 'month'
  if (diff < 365 * 86_400_000) return 'year'
  return 'older'
}
const BUCKET_LABELS: Record<DateBucket, string> = { today:'Today', week:'This Week', month:'This Month', year:'This Year', older:'Older' }

function PriceHistorySection({ history, onDeleteIds }: { history: PriceHistoryEntry[]; onDeleteIds: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  const sorted = [...history].sort((a, b) => b.savedAt - a.savedAt)
  const buckets = new Map<DateBucket, PriceHistoryEntry[]>()
  const BUCKET_ORDER: DateBucket[] = ['today', 'week', 'month', 'year', 'older']
  BUCKET_ORDER.forEach(b => buckets.set(b, []))
  sorted.forEach(h => buckets.get(getBucket(h.savedAt))!.push(h))

  const customIds = (() => {
    if (!customFrom && !customTo) return []
    const from = customFrom ? new Date(customFrom).getTime() : 0
    const to   = customTo   ? new Date(customTo).getTime() + 86_400_000 : Infinity
    return sorted.filter(h => h.savedAt >= from && h.savedAt <= to).map(h => h.id)
  })()

  const toggleSelect = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectBucket = (ids: string[]) => setSelected(s => {
    const n = new Set(s)
    const allSel = ids.every(id => n.has(id))
    ids.forEach(id => allSel ? n.delete(id) : n.add(id))
    return n
  })
  const fmtDate = (ts: number) => new Date(ts).toLocaleString('en-AU', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wide hover:text-slate-700 transition-colors">
        <span>Price History ({history.length})</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-3">
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="text-xs text-red-600 font-semibold flex-1">{selected.size} selected</span>
              <button type="button" onClick={() => { onDeleteIds([...selected]); setSelected(new Set()) }}
                className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 font-semibold">Delete selected</button>
              <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-red-400 hover:text-red-600">Clear</button>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {BUCKET_ORDER.map(bucket => {
              const items = buckets.get(bucket)!
              if (items.length === 0) return null
              const ids = items.map(h => h.id)
              const allSel = ids.every(id => selected.has(id))
              return (
                <button key={bucket} type="button" onClick={() => selectBucket(ids)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${allSel ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {BUCKET_LABELS[bucket]} ({items.length})
                </button>
              )
            })}
            <div className="flex items-center gap-1 ml-1">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] focus:outline-none" />
              <span className="text-slate-300 text-xs">–</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] focus:outline-none" />
              {customIds.length > 0 && (
                <button type="button" onClick={() => selectBucket(customIds)}
                  className="text-[11px] text-blue-500 font-semibold px-2 py-0.5 rounded-full bg-blue-50">Select {customIds.length}</button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {sorted.map(h => (
              <label key={h.id} className={`flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${selected.has(h.id) ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50 hover:bg-slate-100'}`}>
                <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggleSelect(h.id)} className="mt-0.5 flex-shrink-0 rounded border-slate-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400">{fmtDate(h.savedAt)}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-slate-600">
                    <span>Cost: <span className="font-semibold">${h.costPrice.toFixed(2)}</span></span>
                    <span>Floor: <span className="font-semibold">${h.floorSellPrice.toFixed(2)}</span></span>
                    <span>Default: <span className="font-semibold">${h.defaultSellPrice.toFixed(2)}</span></span>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
