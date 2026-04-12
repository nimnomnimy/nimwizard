import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { uid } from '../../lib/utils'
import { showToast } from '../ui/Toast'
import CurrencyInput from '../ui/CurrencyInput'
import type { DealProduct, PriceHistoryEntry, ProductCategory, PricingTier, PricingType, RecurringPeriod } from '../../types'

const CATEGORIES: ProductCategory[] = [
  'Software', 'Hardware', 'Professional Services', 'Technical Services', 'Maintenance',
]

type FormState = {
  name: string
  category: ProductCategory
  pricingType: PricingType
  costPrice: number
  floorSellPrice: number
  defaultSellPrice: number
  fxOverride?: number
  pricingTiers: PricingTier[]
  // recurring
  recurringPeriod: RecurringPeriod
  recurringTermMonths: number
  recurringPricePerPeriod: number
  recurringFloorPricePerPeriod: number
}

const emptyForm = (): FormState => ({
  name: '',
  category: 'Software',
  pricingType: 'one-time',
  costPrice: 0,
  floorSellPrice: 0,
  defaultSellPrice: 0,
  fxOverride: undefined,
  pricingTiers: [],
  recurringPeriod: 'monthly',
  recurringTermMonths: 36,
  recurringPricePerPeriod: 0,
  recurringFloorPricePerPeriod: 0,
})

interface Props {
  productId: string | null   // null = new
  open: boolean
  onClose: () => void
}

export default function ProductDrawer({ productId, open, onClose }: Props) {
  const products       = useAppStore(s => s.dealProducts)
  const addProduct     = useAppStore(s => s.addDealProduct)
  const updateProduct  = useAppStore(s => s.updateDealProduct)
  const deleteProduct  = useAppStore(s => s.deleteDealProduct)

  const existing = productId ? products.find(p => p.id === productId) : null
  const isNew    = !existing

  const [form, setForm]         = useState<FormState>(emptyForm())
  const [fxEnabled, setFxEnabled] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    if (existing) {
      const rc = existing.recurringConfig
      setForm({
        name:             existing.name,
        category:         existing.category,
        pricingType:      existing.pricingType ?? 'one-time',
        costPrice:        existing.costPrice,
        floorSellPrice:   existing.floorSellPrice,
        defaultSellPrice: existing.defaultSellPrice,
        fxOverride:       existing.fxOverride,
        pricingTiers:     existing.pricingTiers ? [...existing.pricingTiers] : [],
        recurringPeriod:          rc?.period ?? 'monthly',
        recurringTermMonths:      rc?.termMonths ?? 36,
        recurringPricePerPeriod:  rc?.pricePerPeriod ?? 0,
        recurringFloorPricePerPeriod: rc?.floorPricePerPeriod ?? 0,
      })
      setFxEnabled(existing.fxOverride !== undefined)
    } else {
      setForm(emptyForm())
      setFxEnabled(false)
    }
    setTimeout(() => nameRef.current?.focus(), 100)
  }, [open, productId])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  // ── Derived: total contract value (recurring) ──────────────────────────────
  const totalContractValue = (() => {
    if (form.pricingType !== 'recurring') return 0
    const periodsPerYear = form.recurringPeriod === 'monthly' ? 12 : 1
    const totalPeriods = form.recurringPeriod === 'monthly'
      ? form.recurringTermMonths
      : Math.ceil(form.recurringTermMonths / 12)
    return form.recurringPricePerPeriod * totalPeriods * (form.recurringPeriod === 'monthly' ? 1 : periodsPerYear / periodsPerYear)
  })()

  // ── Pricing tiers ──────────────────────────────────────────────────────────
  const addTier = () => {
    const tiers = form.pricingTiers
    const lastMax = tiers.length > 0 ? (tiers[tiers.length - 1].maxQty ?? 50) : 0
    set('pricingTiers', [...tiers, { minQty: lastMax + 1, maxQty: null, discountPercent: 5 }])
  }

  const updateTier = (idx: number, patch: Partial<PricingTier>) => {
    const tiers = [...form.pricingTiers]
    tiers[idx] = { ...tiers[idx], ...patch }
    set('pricingTiers', tiers)
  }

  const removeTier = (idx: number) => {
    set('pricingTiers', form.pricingTiers.filter((_, i) => i !== idx))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return

    // For recurring: auto-compute defaultSellPrice and floorSellPrice as total contract value
    let defaultSellPrice = form.defaultSellPrice
    let floorSellPrice   = form.floorSellPrice
    if (form.pricingType === 'recurring') {
      const periods = form.recurringPeriod === 'monthly'
        ? form.recurringTermMonths
        : Math.ceil(form.recurringTermMonths / 12)
      defaultSellPrice = form.recurringPricePerPeriod * periods
      floorSellPrice   = form.recurringFloorPricePerPeriod * periods
    }

    // Append to price history whenever prices actually change
    const prevHistory: PriceHistoryEntry[] = existing?.priceHistory ?? []
    const priceChanged = !existing ||
      existing.costPrice !== (Number(form.costPrice) || 0) ||
      existing.floorSellPrice !== floorSellPrice ||
      existing.defaultSellPrice !== defaultSellPrice
    const newHistory: PriceHistoryEntry[] = priceChanged
      ? [...prevHistory, {
          id: uid(),
          savedAt: Date.now(),
          costPrice: Number(form.costPrice) || 0,
          floorSellPrice,
          defaultSellPrice,
        }]
      : prevHistory

    const product: DealProduct = {
      id:               existing?.id ?? uid(),
      name:             form.name.trim(),
      category:         form.category,
      pricingType:      form.pricingType,
      costPrice:        Number(form.costPrice) || 0,
      floorSellPrice,
      defaultSellPrice,
      recurringConfig: form.pricingType === 'recurring' ? {
        period:                form.recurringPeriod,
        termMonths:            form.recurringTermMonths,
        pricePerPeriod:        form.recurringPricePerPeriod,
        floorPricePerPeriod:   form.recurringFloorPricePerPeriod,
      } : undefined,
      fxOverride:   fxEnabled && form.fxOverride ? Number(form.fxOverride) : undefined,
      pricingTiers: form.pricingTiers,
      priceHistory: newHistory,
      createdAt:    existing?.createdAt ?? Date.now(),
    }

    if (existing) {
      updateProduct(product)
      showToast(`${product.name} updated`, 'success')
    } else {
      addProduct(product)
      showToast(`${product.name} added`, 'success')
    }
    onClose()
  }

  const handleDelete = () => {
    if (!existing) return
    if (!confirm(`Delete "${existing.name}"?`)) return
    deleteProduct(existing.id)
    showToast(`${existing.name} deleted`)
    onClose()
  }

  const n = (v: number) => v === 0 ? '' : String(v)

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />}
      <div className={`
        fixed z-50 bg-white shadow-2xl flex flex-col
        transition-transform duration-300 ease-in-out
        inset-x-0 bottom-0 rounded-t-2xl max-h-[92dvh]
        lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[440px] lg:rounded-none lg:max-h-full
        ${open ? 'translate-y-0 lg:translate-x-0' : 'translate-y-full lg:translate-x-full'}
      `}>
        <div className="lg:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-base font-bold text-slate-900">{isNew ? 'New Product' : 'Edit Product'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto scroll-touch px-4 py-4 flex flex-col gap-5">

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Name <span className="text-red-400">*</span></label>
            <input ref={nameRef} type="text" value={form.name} onChange={e => set('name', e.target.value)} required
              placeholder="e.g. Enterprise Licence"
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Category</label>
            <select value={form.category} onChange={e => set('category', e.target.value as ProductCategory)}
              className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-h-[48px]">
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Pricing type toggle */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pricing Type</label>
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
              {(['one-time', 'recurring'] as PricingType[]).map(t => (
                <button key={t} type="button"
                  onClick={() => set('pricingType', t)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${form.pricingType === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                  {t === 'one-time' ? 'One-Time' : 'Recurring'}
                </button>
              ))}
            </div>
          </div>

          {/* ── ONE-TIME PRICING ─────────────────────────────────────────────── */}
          {form.pricingType === 'one-time' && (
            <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Pricing</p>
              <div className="grid grid-cols-3 gap-2">
                <CurrencyInput label="Cost Price"   valueUsd={form.costPrice}        onChange={v => set('costPrice', v)} />
                <CurrencyInput label="Floor Sell"   valueUsd={form.floorSellPrice}   onChange={v => set('floorSellPrice', v)} />
                <CurrencyInput label="Default Sell" valueUsd={form.defaultSellPrice} onChange={v => set('defaultSellPrice', v)} />
              </div>
              {form.floorSellPrice > 0 && form.costPrice > 0 && (
                <p className="text-xs text-slate-400">
                  Floor margin: <span className="font-semibold text-slate-600">
                    {(((form.floorSellPrice - form.costPrice) / form.floorSellPrice) * 100).toFixed(1)}%
                  </span>
                </p>
              )}
            </div>
          )}

          {/* ── RECURRING PRICING ────────────────────────────────────────────── */}
          {form.pricingType === 'recurring' && (
            <div className="flex flex-col gap-3">
              {/* Billing period + term */}
              <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Subscription Term</p>
                <div className="grid grid-cols-2 gap-3">
                  {/* Billing period */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-400">Billing Period</label>
                    <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden">
                      {(['monthly', 'annual'] as RecurringPeriod[]).map(p => (
                        <button key={p} type="button"
                          onClick={() => set('recurringPeriod', p)}
                          className={`flex-1 py-2 text-xs font-semibold capitalize transition-colors ${form.recurringPeriod === p ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-50'}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Term */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-semibold text-slate-400">Term (months)</label>
                    <input type="number" min="1" step="1" value={n(form.recurringTermMonths)}
                      onChange={e => set('recurringTermMonths', parseInt(e.target.value) || 12)}
                      placeholder="36"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px] bg-white" />
                  </div>
                </div>
              </div>

              {/* Per-period pricing */}
              <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Pricing per {form.recurringPeriod === 'monthly' ? 'Month' : 'Year'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <CurrencyInput label="Price"       valueUsd={form.recurringPricePerPeriod}      onChange={v => set('recurringPricePerPeriod', v)} />
                  <CurrencyInput label="Floor Price"  valueUsd={form.recurringFloorPricePerPeriod} onChange={v => set('recurringFloorPricePerPeriod', v)} />
                </div>
                {form.recurringPricePerPeriod > 0 && (
                  <div className="bg-indigo-50 rounded-lg p-2.5">
                    <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-wide">Total Contract Value</p>
                    <p className="text-sm font-bold text-indigo-800 mt-0.5">
                      ${(form.recurringPricePerPeriod * (form.recurringPeriod === 'monthly' ? form.recurringTermMonths : Math.ceil(form.recurringTermMonths / 12))).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-[11px] text-indigo-400 mt-0.5">
                      {form.recurringPeriod === 'monthly' ? form.recurringTermMonths : Math.ceil(form.recurringTermMonths / 12)} payments × ${form.recurringPricePerPeriod.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/{form.recurringPeriod === 'monthly' ? 'mo' : 'yr'}
                    </p>
                  </div>
                )}
              </div>

              {/* Cost (total for whole term) */}
              <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Cost (Total Term)</p>
                <CurrencyInput valueUsd={form.costPrice} onChange={v => set('costPrice', v)} placeholder="Total cost for full term" />
                {form.costPrice > 0 && totalContractValue > 0 && (
                  <p className="text-xs text-slate-400">
                    Margin: <span className="font-semibold text-slate-600">
                      {(((totalContractValue - form.costPrice) / totalContractValue) * 100).toFixed(1)}%
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* FX override */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button type="button" role="switch" aria-checked={fxEnabled}
                onClick={() => setFxEnabled(v => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${fxEnabled ? 'bg-blue-500' : 'bg-slate-200'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${fxEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
              <span className="text-sm font-medium text-slate-700">Custom FX rate (USD → AUD)</span>
            </label>
            {fxEnabled && (
              <input type="number" min="0" step="0.0001"
                value={form.fxOverride ?? ''}
                onChange={e => set('fxOverride', parseFloat(e.target.value) || undefined)}
                placeholder="e.g. 1.58"
                className="w-full px-3 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[48px]" />
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

          {/* ── PRICE HISTORY ──────────────────────────────────────────────── */}
          {existing && (existing.priceHistory?.length ?? 0) > 0 && (
            <PriceHistorySection
              history={existing.priceHistory!}
              onDeleteIds={ids => {
                const filtered = (existing.priceHistory ?? []).filter(h => !ids.includes(h.id))
                updateProduct({ ...existing, priceHistory: filtered })
                showToast(`${ids.length} record${ids.length > 1 ? 's' : ''} deleted`)
              }}
            />
          )}

          <div className="h-2" />
        </form>

        {/* Actions */}
        <div className="flex gap-3 px-4 py-4 border-t border-slate-100 flex-shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {!isNew && (
            <button type="button" onClick={handleDelete}
              className="px-4 py-3 rounded-xl border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 min-h-[48px] transition-colors">
              Delete
            </button>
          )}
          <button onClick={handleSubmit}
            className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 min-h-[48px] transition-colors">
            {isNew ? 'Create Product' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Price History Section ─────────────────────────────────────────────────────

type DateBucket = 'today' | 'week' | 'month' | 'year' | 'older'

function getBucket(ts: number): DateBucket {
  const now = Date.now()
  const diff = now - ts
  if (diff < 86_400_000)       return 'today'
  if (diff < 7  * 86_400_000)  return 'week'
  if (diff < 30 * 86_400_000)  return 'month'
  if (diff < 365 * 86_400_000) return 'year'
  return 'older'
}

const BUCKET_LABELS: Record<DateBucket, string> = {
  today: 'Today',
  week:  'This Week',
  month: 'This Month',
  year:  'This Year',
  older: 'Older',
}

function PriceHistorySection({
  history,
  onDeleteIds,
}: {
  history: PriceHistoryEntry[]
  onDeleteIds: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  const sorted = [...history].sort((a, b) => b.savedAt - a.savedAt)

  // Group by bucket
  const buckets = new Map<DateBucket | 'custom', PriceHistoryEntry[]>()
  const BUCKET_ORDER: DateBucket[] = ['today', 'week', 'month', 'year', 'older']
  BUCKET_ORDER.forEach(b => buckets.set(b, []))
  sorted.forEach(h => {
    const b = getBucket(h.savedAt)
    buckets.get(b)!.push(h)
  })

  // Custom range filter
  const customIds = (() => {
    if (!customFrom && !customTo) return []
    const from = customFrom ? new Date(customFrom).getTime() : 0
    const to   = customTo   ? new Date(customTo).getTime() + 86_400_000 : Infinity
    return sorted.filter(h => h.savedAt >= from && h.savedAt <= to).map(h => h.id)
  })()

  const toggleSelect = (id: string) => {
    setSelected(s => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const selectBucket = (ids: string[]) => {
    setSelected(s => {
      const n = new Set(s)
      const allSelected = ids.every(id => n.has(id))
      ids.forEach(id => allSelected ? n.delete(id) : n.add(id))
      return n
    })
  }

  const fmt = (ts: number) => new Date(ts).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

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
          {/* Batch delete controls */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span className="text-xs text-red-600 font-semibold flex-1">{selected.size} selected</span>
              <button type="button"
                onClick={() => { onDeleteIds([...selected]); setSelected(new Set()) }}
                className="text-xs bg-red-500 text-white px-3 py-1 rounded-lg hover:bg-red-600 font-semibold">
                Delete selected
              </button>
              <button type="button" onClick={() => setSelected(new Set())}
                className="text-xs text-red-400 hover:text-red-600">Clear</button>
            </div>
          )}

          {/* Date bucket pills */}
          <div className="flex flex-wrap gap-1.5">
            {BUCKET_ORDER.map(bucket => {
              const items = buckets.get(bucket)!
              if (items.length === 0) return null
              const ids = items.map(h => h.id)
              const allSel = ids.every(id => selected.has(id))
              return (
                <button key={bucket} type="button"
                  onClick={() => selectBucket(ids)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                    allSel ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {BUCKET_LABELS[bucket]} ({items.length})
                </button>
              )
            })}
            {/* Custom range */}
            <div className="flex items-center gap-1 ml-1">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <span className="text-slate-300 text-xs">–</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500" />
              {customIds.length > 0 && (
                <button type="button" onClick={() => selectBucket(customIds)}
                  className="text-[11px] text-blue-500 hover:text-blue-700 font-semibold px-2 py-0.5 rounded-full bg-blue-50">
                  Select {customIds.length}
                </button>
              )}
            </div>
          </div>

          {/* History rows */}
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {sorted.map(h => (
              <label key={h.id} className={`flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${selected.has(h.id) ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50 hover:bg-slate-100'}`}>
                <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggleSelect(h.id)}
                  className="mt-0.5 flex-shrink-0 rounded border-slate-300" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-400">{fmt(h.savedAt)}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-slate-600">
                    <span>Cost: <span className="font-semibold">${h.costPrice.toFixed(2)}</span></span>
                    <span>Floor: <span className="font-semibold">${h.floorSellPrice.toFixed(2)}</span></span>
                    <span>Default: <span className="font-semibold">${h.defaultSellPrice.toFixed(2)}</span></span>
                  </div>
                  {h.note && <p className="text-[10px] text-slate-400 mt-0.5 italic">{h.note}</p>}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
