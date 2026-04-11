import { useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useCurrency } from '../store/useCurrency'
import CurrencyBar from '../components/ui/CurrencyBar'
import ProductDrawer from '../components/deals/ProductDrawer'
import type { DealProduct, ProductCategory } from '../types'

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

export default function ProductsPage() {
  const products = useAppStore(s => s.dealProducts)
  const fmt           = useCurrency(s => s.fmt)
  const fmtAud        = useCurrency(s => s.fmtAud)
  const showSecondary = useCurrency(s => s.showSecondary)

  const [drawerProductId, setDrawerProductId] = useState<string | null | undefined>(undefined)
  const [search, setSearch]   = useState('')
  const [filterCat, setFilterCat] = useState<ProductCategory | 'all'>('all')
  const [filterType, setFilterType] = useState<'all' | 'one-time' | 'recurring'>('all')
  const [activeId, setActiveId] = useState<string | null>(null)

  const filtered = products.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = filterCat === 'all' || p.category === filterCat
    const matchType   = filterType === 'all' || p.pricingType === filterType
    return matchSearch && matchCat && matchType
  }).sort((a, b) => a.name.localeCompare(b.name))

  const active = products.find(p => p.id === activeId) ?? null

  function priceDisplay(p: DealProduct): { primary: string; secondary?: string; sub?: string } {
    if (p.pricingType === 'recurring' && p.recurringConfig) {
      const rc = p.recurringConfig
      const priceLabel = rc.period === 'monthly' ? '/mo' : '/yr'
      const primary   = fmt(rc.pricePerPeriod)
      const secondary = showSecondary ? fmtAud(rc.pricePerPeriod) : undefined
      return { primary: `${primary}${priceLabel}`, secondary: secondary ? `${secondary}${priceLabel}` : undefined, sub: `${rc.termMonths}mo term` }
    }
    return {
      primary: fmt(p.defaultSellPrice),
      secondary: showSecondary ? fmtAud(p.defaultSellPrice) : undefined,
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-slate-100">

      {/* Left pane — list */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 text-sm">Products</h2>
            <button onClick={() => setDrawerProductId(null)}
              className="flex items-center gap-1 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1.5 rounded-lg font-semibold transition-colors">
              + New
            </button>
          </div>
          <CurrencyBar />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {/* Type filter */}
          <div className="flex gap-1">
            {(['all', 'one-time', 'recurring'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`text-[11px] px-2 py-0.5 rounded-full font-semibold transition-colors capitalize ${filterType === t ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {t === 'all' ? 'All' : t}
              </button>
            ))}
          </div>
          {/* Category filter */}
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
          {products.length} product{products.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Right pane — detail */}
      <div className="flex-1 overflow-y-auto">
        {!active ? (
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
          <div className="max-w-3xl mx-auto p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[active.category]}`}>
                    {active.category}
                  </span>
                  {active.pricingType === 'recurring' && (
                    <span className="text-xs bg-indigo-100 text-indigo-600 font-semibold px-2 py-0.5 rounded-full">Recurring</span>
                  )}
                </div>
                <h1 className="text-xl font-bold text-slate-900">{active.name}</h1>
              </div>
              <button onClick={() => setDrawerProductId(active.id)}
                className="text-xs border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-semibold text-slate-600 transition-colors">
                Edit
              </button>
            </div>

            {/* Pricing tiles */}
            {active.pricingType === 'one-time' ? (
              <div className="grid grid-cols-3 gap-3">
                <PriceTile label="Cost Price" usd={active.costPrice} fmt={fmt} fmtAud={fmtAud} showBoth={showSecondary} />
                <PriceTile label="Floor Sell" usd={active.floorSellPrice} fmt={fmt} fmtAud={fmtAud} showBoth={showSecondary} highlight />
                <PriceTile label="Default Sell" usd={active.defaultSellPrice} fmt={fmt} fmtAud={fmtAud} showBoth={showSecondary} highlight />
              </div>
            ) : active.recurringConfig ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <InfoTile label="Term" value={`${active.recurringConfig.termMonths} months`} />
                  <InfoTile label="Billing" value={active.recurringConfig.period === 'monthly' ? 'Monthly' : 'Annual'} />
                  <PriceTile label={`Price/${active.recurringConfig.period === 'monthly' ? 'mo' : 'yr'}`}
                    usd={active.recurringConfig.pricePerPeriod} fmt={fmt} fmtAud={fmtAud} showBoth={showSecondary} highlight />
                  <PriceTile label={`Floor/${active.recurringConfig.period === 'monthly' ? 'mo' : 'yr'}`}
                    usd={active.recurringConfig.floorPricePerPeriod} fmt={fmt} fmtAud={fmtAud} showBoth={showSecondary} />
                </div>
                {/* Total contract value */}
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                  <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-1">Total Contract Value</p>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-[11px] text-indigo-400">Default ({active.recurringConfig.termMonths}mo)</p>
                      <p className="text-base font-bold text-indigo-800">{fmt(active.defaultSellPrice)}</p>
                      {showSecondary && <p className="text-xs text-indigo-400">{fmtAud(active.defaultSellPrice)}</p>}
                    </div>
                    <div>
                      <p className="text-[11px] text-indigo-400">Cost ({active.recurringConfig.termMonths}mo)</p>
                      <p className="text-base font-bold text-indigo-700">{fmt(active.costPrice)}</p>
                      {showSecondary && <p className="text-xs text-indigo-400">{fmtAud(active.costPrice)}</p>}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Margin summary */}
            {active.floorSellPrice > 0 && active.costPrice > 0 && (
              <div className="bg-slate-50 rounded-xl p-4 flex gap-6">
                <div>
                  <p className="text-[11px] text-slate-400 font-semibold uppercase">Floor Margin</p>
                  <p className="text-lg font-bold text-slate-700">
                    {(((active.floorSellPrice - active.costPrice) / active.floorSellPrice) * 100).toFixed(1)}%
                  </p>
                </div>
                {active.defaultSellPrice > 0 && (
                  <div>
                    <p className="text-[11px] text-slate-400 font-semibold uppercase">Default Margin</p>
                    <p className="text-lg font-bold text-green-700">
                      {(((active.defaultSellPrice - active.costPrice) / active.defaultSellPrice) * 100).toFixed(1)}%
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* FX override */}
            {active.fxOverride && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                <p className="text-xs font-bold text-blue-600">Custom FX Override</p>
                <p className="text-sm text-blue-700 mt-0.5">{active.fxOverride.toFixed(4)} USD→AUD</p>
              </div>
            )}

            {/* Pricing tiers */}
            {active.pricingTiers && active.pricingTiers.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Quantity-Based Tiers</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs font-semibold text-slate-400 border-b border-slate-100">
                      <th className="px-4 py-2 text-left">Min Qty</th>
                      <th className="px-4 py-2 text-left">Max Qty</th>
                      <th className="px-4 py-2 text-right">Discount</th>
                      <th className="px-4 py-2 text-right">Effective Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.pricingTiers.map((tier, i) => {
                      const basePrice = active.pricingType === 'recurring' && active.recurringConfig
                        ? active.recurringConfig.pricePerPeriod
                        : active.defaultSellPrice
                      const effectiveUsd = basePrice * (1 - tier.discountPercent / 100)
                      return (
                        <tr key={i} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-2">{tier.minQty}</td>
                          <td className="px-4 py-2">{tier.maxQty ?? '∞'}</td>
                          <td className="px-4 py-2 text-right text-amber-600 font-semibold">{tier.discountPercent}%</td>
                          <td className="px-4 py-2 text-right font-semibold text-slate-700">
                            {fmt(effectiveUsd)}
                            {showSecondary && <span className="block text-[10px] text-slate-400">{fmtAud(effectiveUsd)}</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-slate-400">Created {new Date(active.createdAt).toLocaleDateString('en-AU')}</p>
          </div>
        )}
      </div>

      {/* Product drawer */}
      {drawerProductId !== undefined && (
        <ProductDrawer
          productId={drawerProductId}
          open={true}
          onClose={() => { setDrawerProductId(undefined) }}
        />
      )}
    </div>
  )
}

function PriceTile({ label, usd, fmt, fmtAud, showBoth, highlight }: {
  label: string; usd: number
  fmt: (n: number) => string; fmtAud: (n: number) => string
  showBoth: boolean; highlight?: boolean
}) {
  return (
    <div className={`rounded-xl p-3 flex flex-col gap-0.5 ${highlight ? 'bg-white border border-slate-200' : 'bg-slate-50'}`}>
      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-base font-bold text-slate-900">{fmt(usd)}</p>
      {showBoth && <p className="text-xs text-slate-400">{fmtAud(usd)}</p>}
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3 flex flex-col gap-0.5">
      <p className="text-[11px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}
