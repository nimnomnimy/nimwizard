import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useCurrency } from '../store/useCurrency'
import { uid } from '../lib/utils'
import { showToast } from '../components/ui/Toast'
import CurrencyBar from '../components/ui/CurrencyBar'
import ProductConfigEditor from '../components/products/ProductConfigEditor'
import { useResizable } from '../hooks/useResizable'
import type {
  DealProduct, PriceHistoryEntry, ProductCategory, ProductConfiguration, ConfigGroup,
  PricingTier, PricingType, RecurringPeriod,
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

function groupFieldTotal(g: ConfigGroup, field: 'cost' | 'floor' | 'sell'): number {
  if (!g?.children) return 0
  return g.children.reduce((s, c) => {
    if (c.type === 'row') {
      const price = field === 'cost' ? c.row.costPriceUsd : field === 'floor' ? c.row.floorPriceUsd : c.row.sellPriceUsd
      return s + (price ?? 0) * (c.row.quantity ?? 1) * (c.row.termMonths ?? 1)
    }
    if (c.type === 'subgroup') return s + groupFieldTotal(c.group, field)
    return s
  }, 0)
}

function configsTotal(configs: ProductConfiguration[], field: 'cost' | 'floor' | 'sell'): number {
  if (!configs?.length) return 0
  return configs.reduce((s, cfg) => s + (cfg.groups ?? []).reduce((gs, g) => gs + groupFieldTotal(g, field), 0), 0)
}

// ─── Form state ───────────────────────────────────────────────────────────────

type FormState = {
  name: string
  category: ProductCategory
  pricingType: PricingType
  costPrice: string
  floorSellPrice: string
  defaultSellPrice: string
  fxOverride?: number
  fxEnabled: boolean
  pricingTiers: PricingTier[]
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
    fxOverride: undefined,
    fxEnabled: false,
    pricingTiers: [],
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
    fxOverride: p.fxOverride,
    fxEnabled: p.fxOverride !== undefined,
    pricingTiers: p.pricingTiers ? [...p.pricingTiers] : [],
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
  const left = useResizable({ initial: 260, min: 180, max: 400 })

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
      setDirty(false)
    }
  }, [activeId])

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
    setDirty(true)
  }

  function handleConfigsChange(productId: string, configs: ProductConfiguration[]) {
    const p = products.find(x => x.id === productId)
    if (!p) return
    updateProduct({ ...p, configurations: configs })
  }

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = filterCat === 'all' || p.category === filterCat
    const matchType   = filterType === 'all' || p.pricingType === filterType
    return matchSearch && matchCat && matchType
  }).sort((a, b) => a.name.localeCompare(b.name))

  function priceDisplay(p: DealProduct): { primary: string; secondary?: string; sub?: string } {
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
      fxOverride:     form.fxEnabled && form.fxOverride ? Number(form.fxOverride) : undefined,
      pricingTiers:   form.pricingTiers,
      priceHistory:   newHistory,
      createdAt:      existing?.createdAt ?? Date.now(),
      configurations: existing?.configurations,
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

  function handleDelete() {
    if (!existing) return
    if (!confirm(`Delete "${existing.name}"?`)) return
    deleteProduct(existing.id)
    showToast(`${existing.name} deleted`)
    setActiveId(undefined)
  }

  function addTier() {
    const tiers = form.pricingTiers
    const lastMax = tiers.length > 0 ? (tiers[tiers.length - 1].maxQty ?? 50) : 0
    set('pricingTiers', [...tiers, { minQty: lastMax + 1, maxQty: null, discountPercent: 5 }])
  }
  function updateTier(idx: number, patch: Partial<PricingTier>) {
    const tiers = [...form.pricingTiers]; tiers[idx] = { ...tiers[idx], ...patch }
    set('pricingTiers', tiers)
  }
  function removeTier(idx: number) {
    set('pricingTiers', form.pricingTiers.filter((_, i) => i !== idx))
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-100">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 flex-shrink-0 px-4 flex items-center gap-3 flex-wrap" style={{ minHeight: 52 }}>
        <h2 className="text-sm font-bold text-slate-700 flex-shrink-0">Products</h2>
        <CurrencyBar />
        <button
          onClick={() => { setActiveId(null) }}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition-colors flex-shrink-0">
          + New Product
        </button>
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
              addTier={addTier}
              updateTier={updateTier}
              removeTier={removeTier}
              nameRef={nameRef}
              fmt={fmt}
              fmtAud={fmtAud}
              showSecondary={showSecondary}
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
  set, onSave, onDelete, onDeleteHistoryIds, onConfigsChange,
  addTier, updateTier, removeTier,
  nameRef, fmt, fmtAud, showSecondary,
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
  onDeleteHistoryIds: (ids: string[]) => void
  onConfigsChange: (cfgs: ProductConfiguration[]) => void
  addTier: () => void
  updateTier: (idx: number, patch: Partial<PricingTier>) => void
  removeTier: (idx: number) => void
  nameRef: React.RefObject<HTMLInputElement | null>
  fmt: (n: number) => string
  fmtAud: (n: number) => string
  showSecondary: boolean
}) {
  const hasConfigs = configs.length > 0 && configs.some(c => (c.groups ?? []).some(g => (g.children ?? []).length > 0))

  // Derived price tiles
  const cost  = hasConfigs ? configsTotal(configs, 'cost')  : parsePrice(form.costPrice)
  const floor = hasConfigs ? configsTotal(configs, 'floor') : parsePrice(form.floorSellPrice)
  const sell  = hasConfigs ? configsTotal(configs, 'sell')  : parsePrice(form.defaultSellPrice)

  const recurringPrice = parsePrice(form.recurringPricePerPeriod)
  const recurringFloor = parsePrice(form.recurringFloorPricePerPeriod)
  const periods = form.recurringPeriod === 'monthly'
    ? form.recurringTermMonths
    : Math.ceil(form.recurringTermMonths / 12)

  return (
    <form onSubmit={onSave} className="max-w-3xl mx-auto p-6 flex flex-col gap-6">
      {/* ── Name + meta header ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <select
            value={form.category}
            onChange={e => set('category', e.target.value as ProductCategory)}
            className={`text-xs font-semibold px-2 py-0.5 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer ${CATEGORY_COLORS[form.category]}`}
            style={{ appearance: 'none' }}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {(['one-time', 'recurring'] as PricingType[]).map(t => (
              <button key={t} type="button" onClick={() => set('pricingType', t)}
                className={`text-[11px] px-2 py-0.5 rounded font-semibold transition-colors ${form.pricingType === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                {t === 'one-time' ? 'One-Time' : 'Recurring'}
              </button>
            ))}
          </div>
        </div>

        <input
          ref={nameRef}
          type="text"
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="Product name…"
          required
          className="text-2xl font-bold text-slate-900 bg-transparent border-0 focus:outline-none focus:bg-slate-50 rounded-lg px-1 py-0.5 -ml-1 w-full placeholder:text-slate-300"
        />
      </div>

      {/* ── Price tiles ── */}
      {form.pricingType === 'one-time' && (
        <div className="grid grid-cols-3 gap-3">
          <PriceTileInput
            label="Cost Price"
            displayValue={fmt(cost)}
            displaySecondary={showSecondary ? fmtAud(cost) : undefined}
            inputValue={form.costPrice}
            onChange={v => set('costPrice', v)}
            locked={hasConfigs}
          />
          <PriceTileInput
            label="Floor Sell"
            displayValue={fmt(floor)}
            displaySecondary={showSecondary ? fmtAud(floor) : undefined}
            inputValue={form.floorSellPrice}
            onChange={v => set('floorSellPrice', v)}
            locked={hasConfigs}
            highlight
          />
          <PriceTileInput
            label="Default Sell"
            displayValue={fmt(sell)}
            displaySecondary={showSecondary ? fmtAud(sell) : undefined}
            inputValue={form.defaultSellPrice}
            onChange={v => set('defaultSellPrice', v)}
            locked={hasConfigs}
            highlight
          />
        </div>
      )}

      {form.pricingType === 'recurring' && (
        <div className="flex flex-col gap-3">
          {/* Term config */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
              {(['monthly', 'annual'] as RecurringPeriod[]).map(p => (
                <button key={p} type="button" onClick={() => set('recurringPeriod', p)}
                  className={`text-xs px-2.5 py-1 rounded font-semibold capitalize transition-colors ${form.recurringPeriod === p ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  {p}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <input type="number" min="1" step="1" value={form.recurringTermMonths || ''}
                onChange={e => set('recurringTermMonths', parseInt(e.target.value) || 12)}
                className="w-14 px-2 py-1 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
              />
              <span>months term</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PriceTileInput
              label={`Price / ${form.recurringPeriod === 'monthly' ? 'mo' : 'yr'}`}
              displayValue={fmt(recurringPrice)}
              displaySecondary={showSecondary ? fmtAud(recurringPrice) : undefined}
              inputValue={form.recurringPricePerPeriod}
              onChange={v => set('recurringPricePerPeriod', v)}
              locked={false}
              highlight
            />
            <PriceTileInput
              label={`Floor / ${form.recurringPeriod === 'monthly' ? 'mo' : 'yr'}`}
              displayValue={fmt(recurringFloor)}
              displaySecondary={showSecondary ? fmtAud(recurringFloor) : undefined}
              inputValue={form.recurringFloorPricePerPeriod}
              onChange={v => set('recurringFloorPricePerPeriod', v)}
              locked={false}
            />
          </div>
          {recurringPrice > 0 && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 flex items-center gap-6">
              <div>
                <p className="text-[11px] font-bold text-indigo-500 uppercase tracking-wide">Total Contract Value</p>
                <p className="text-base font-bold text-indigo-800">{fmt(recurringPrice * periods)}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold text-indigo-400 uppercase tracking-wide">Cost (full term)</p>
                <PriceInlineInput value={form.recurringCostPrice} onChange={v => set('recurringCostPrice', v)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Margin */}
      {floor > 0 && cost > 0 && form.pricingType === 'one-time' && (
        <div className="flex gap-6 px-1">
          <div>
            <p className="text-[11px] text-slate-400 font-semibold uppercase">Floor Margin</p>
            <p className="text-lg font-bold text-slate-700">{(((floor - cost) / floor) * 100).toFixed(1)}%</p>
          </div>
          {sell > 0 && (
            <div>
              <p className="text-[11px] text-slate-400 font-semibold uppercase">Default Margin</p>
              <p className="text-lg font-bold text-green-700">{(((sell - cost) / sell) * 100).toFixed(1)}%</p>
            </div>
          )}
        </div>
      )}

      {/* FX override */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button type="button" role="switch" aria-checked={form.fxEnabled}
            onClick={() => set('fxEnabled', !form.fxEnabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${form.fxEnabled ? 'bg-blue-500' : 'bg-slate-200'}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.fxEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
          <span className="text-sm text-slate-600">Custom FX rate (USD → AUD)</span>
        </label>
        {form.fxEnabled && (
          <input type="number" min="0" step="0.0001"
            value={form.fxOverride ?? ''}
            onChange={e => set('fxOverride', parseFloat(e.target.value) || undefined)}
            placeholder="e.g. 1.58"
            className="w-40 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
      </div>

      {/* Pricing tiers */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
            {form.pricingType === 'recurring' ? 'Per-Period Tier Discounts' : 'Quantity-Based Tiers'}
          </p>
          <button type="button" onClick={addTier}
            className="text-xs text-blue-500 hover:text-blue-700 font-semibold px-2 py-1 rounded-lg hover:bg-blue-50">
            + Add Tier
          </button>
        </div>
        {form.pricingTiers.length === 0 && (
          <p className="text-xs text-slate-400 italic">No tiers — standard price applies.</p>
        )}
        {form.pricingTiers.map((tier, idx) => (
          <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-xl p-2">
            <div className="flex flex-col gap-0.5 flex-1">
              <label className="text-[10px] text-slate-400 font-semibold">Min Qty</label>
              <input type="number" min="1" value={tier.minQty}
                onChange={e => updateTier(idx, { minQty: parseInt(e.target.value) || 1 })}
                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" />
            </div>
            <div className="flex flex-col gap-0.5 flex-1">
              <label className="text-[10px] text-slate-400 font-semibold">Max Qty</label>
              <input type="number" min="1" value={tier.maxQty ?? ''}
                onChange={e => updateTier(idx, { maxQty: e.target.value ? parseInt(e.target.value) : null })}
                placeholder="∞"
                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" />
            </div>
            <div className="flex flex-col gap-0.5 flex-1">
              <label className="text-[10px] text-slate-400 font-semibold">Discount %</label>
              <input type="number" min="0" max="100" step="0.5" value={tier.discountPercent}
                onChange={e => updateTier(idx, { discountPercent: parseFloat(e.target.value) || 0 })}
                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" />
            </div>
            <button type="button" onClick={() => removeTier(idx)}
              className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 mt-4 flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        ))}
      </div>

      {/* Price history */}
      {!isNew && existing && (existing.priceHistory?.length ?? 0) > 0 && (
        <PriceHistorySection
          history={existing.priceHistory!}
          onDeleteIds={onDeleteHistoryIds}
        />

      )}

      {/* Save / delete bar */}
      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        {!isNew && (
          <button type="button" onClick={onDelete}
            className="px-4 py-2 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors">
            Delete
          </button>
        )}
        <button
          type="submit"
          disabled={!dirty && !isNew}
          className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          {isNew ? 'Create Product' : 'Save Changes'}
        </button>
      </div>

      {/* ── Configurations ── */}
      {!isNew && existing && (
        <div className="border-t border-slate-100 pt-4">
          <ProductConfigEditor
            configs={configs}
            onChange={onConfigsChange}
          />
        </div>
      )}

      {isNew && (
        <p className="text-xs text-slate-400 text-center">Save the product first to add configurations.</p>
      )}
    </form>
  )
}

// ─── Price tile with inline edit input ────────────────────────────────────────

function PriceTileInput({
  label, displayValue, displaySecondary, inputValue, onChange, locked, highlight,
}: {
  label: string
  displayValue: string
  displaySecondary?: string
  inputValue: string
  onChange: (v: string) => void
  locked: boolean
  highlight?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  return (
    <div
      className={`rounded-xl p-3 flex flex-col gap-0.5 cursor-pointer transition-colors ${highlight ? 'bg-white border border-slate-200 hover:border-blue-300' : 'bg-slate-50 hover:bg-slate-100'} ${locked ? 'cursor-default' : ''}`}
      onClick={() => !locked && !editing && setEditing(true)}
    >
      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
      {locked || !editing ? (
        <>
          <p className="text-base font-bold text-slate-900">{displayValue}</p>
          {displaySecondary && <p className="text-xs text-slate-400">{displaySecondary}</p>}
          {locked && <p className="text-[10px] text-blue-400">from config</p>}
        </>
      ) : (
        <div className="flex items-center gap-1">
          <span className="text-slate-400 text-sm">$</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={inputValue}
            onChange={e => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false) }}
            className="flex-1 text-base font-bold text-slate-900 bg-transparent focus:outline-none w-full"
          />
        </div>
      )}
    </div>
  )
}

// Inline price input for inside other tiles
function PriceInlineInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 mt-0.5">
      <span className="text-indigo-400 text-sm">$</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="0"
        className="w-28 text-base font-bold text-indigo-800 bg-transparent focus:outline-none border-b border-indigo-200 focus:border-indigo-400"
      />
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
